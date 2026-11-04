"use client";

import type { Autional } from "@autional/core";

/**
 * Token 会话加固。
 *
 * 背景：@autional/core 0.4.1 的 `Autional.getAccessToken()` 会把任何刷新异常
 * 都吞成 null，UI 无法区分“网络抖动”和“凭证失效”；同时 `initialize()` 会在
 * 应用层锁之外刷新，多标签可能拿同一个 refresh token 并发刷新。
 *
 * 做法：在实例创建后接管 `refreshSession`（SDK 里 initialize / getAccessToken /
 * ApiClient 401 三条路径的唯一刷新入口），统一实现：
 *   - 跨标签锁（Web Locks / 本地租约），fail-closed；
 *   - 刷新前按 exp 单调合并持久化 token；
 *   - 按端点/响应形状做错误分类；
 *   - 刷新结果写回前校验 refresh token 未被登出/轮换；
 *   - 写后读校验 + 广播。
 */

export type TokenIssue = "expired" | "revoked" | "transient" | "config";

export class TokenRefreshError extends Error {
  constructor(
    readonly issue: TokenIssue,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

export type EnsureTokenResult =
  | { ok: true; token: string }
  | { ok: false; issue: TokenIssue; error?: unknown };

const LOCK_NAME = "marktext:token-refresh";
const CHANNEL_NAME = "autional:sync";
const REFRESH_TIMEOUT_MS = 9_000;
const LEASE_TTL_MS = 15_000;
const LEASE_WAIT_MS = 10_000;

const installed = new WeakSet<object>();

/* ---------------- 纯函数（可单测） ---------------- */

export function decodeJwtExp(token: string | null | undefined): number | null {
  if (!token || token.split(".").length !== 3) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part)) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken?: string; expiresIn: number }
  | { ok: false; issue: TokenIssue; code?: string; message?: string };

/** 按“端点 × 响应形状 × code/error”分类；未知一律 transient。 */
export function classifyRefresh(
  mode: "password" | "sso",
  status: number,
  body: unknown,
): RefreshOutcome {
  const json = (body ?? {}) as Record<string, unknown>;
  const data = (json.data ?? json) as Record<string, unknown>;

  if (status === 200) {
    const accessToken = data.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      return { ok: false, issue: "transient", message: "刷新响应缺少 access_token" };
    }
    if (!decodeJwtExp(accessToken)) {
      return { ok: false, issue: "transient", message: "刷新响应 access_token 非法" };
    }
    if (json.code !== undefined && json.code !== 0) {
      return { ok: false, issue: "transient", message: "刷新响应 code 非 0" };
    }
    return {
      ok: true,
      accessToken,
      refreshToken:
        typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      expiresIn:
        typeof data.expires_in === "number" ? data.expires_in : 300,
    };
  }

  if (mode === "sso") {
    const error = String(json.error ?? "");
    const description = String(json.error_description ?? json.message ?? "");
    if (error === "invalid_grant") {
      return {
        ok: false,
        issue: /reus/i.test(description) ? "revoked" : "expired",
        code: error,
        message: description,
      };
    }
    if (error === "invalid_client") {
      return { ok: false, issue: "config", code: error, message: description };
    }
    if (status === 401) {
      return { ok: false, issue: "expired", code: error, message: description };
    }
    if (status === 403) {
      return { ok: false, issue: "config", code: error, message: description };
    }
  } else {
    const code = String(json.code ?? "");
    if (code === "40000502") {
      const message = String(json.message ?? json.detail ?? "");
      return {
        ok: false,
        issue: /reus/i.test(message) ? "revoked" : "expired",
        code,
        message,
      };
    }
    if (status === 401) {
      return { ok: false, issue: "expired", code, message: String(json.message ?? "") };
    }
    if (status === 403) {
      return { ok: false, issue: "config", code, message: String(json.message ?? "") };
    }
  }

  return {
    ok: false,
    issue: "transient",
    code: String(json.code ?? json.error ?? ""),
    message: String(json.message ?? json.error_description ?? ""),
  };
}

/** 存储里是更新的一代时才采纳（AT/RT 成对，避免倒退）。 */
export function storageIsNewer(
  storageAccessToken: string | null | undefined,
  memoryAccessToken: string | null | undefined,
): boolean {
  const storageExp = decodeJwtExp(storageAccessToken);
  if (!storageExp) return false;
  const memoryExp = decodeJwtExp(memoryAccessToken);
  if (!memoryExp) return true;
  return storageExp > memoryExp;
}

/* ---------------- 运行时工具 ---------------- */

function apiBase(autional: Autional): string {
  const configured =
    (autional as unknown as { config?: { apiUrl?: string } }).config?.apiUrl ??
    process.env.NEXT_PUBLIC_AUTIONAL_API_URL ??
    "/bff";
  return configured.replace(/\/$/, "");
}

function internals(tm: unknown): {
  storage?: { getItem(key: string): string | null };
  key: string;
} {
  const anyTm = tm as {
    storage?: { getItem(key: string): string | null };
    storageKey?: (key: string) => string;
    prefix?: string;
  };
  return {
    storage: anyTm.storage,
    key: anyTm.storageKey ? anyTm.storageKey("tokens") : `${anyTm.prefix ?? "autional_"}tokens`,
  };
}

async function readStoredToken(tm: unknown): Promise<string | null> {
  try {
    const { storage, key } = internals(tm);
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accessToken?: string | null };
    return parsed.accessToken ?? null;
  } catch {
    return null;
  }
}

async function mergeFromStorage(autional: Autional): Promise<void> {
  const tm = autional.tokenManager;
  const stored = await readStoredToken(tm);
  if (!stored) return;

  const memory = tm.getAccessToken();
  if (memory) {
    if (storageIsNewer(stored, memory)) await tm.load();
    return;
  }

  // 内存里没有可用 token：只要存储里的还没过期，就采纳（AT/RT 成对 load）
  const storedExp = decodeJwtExp(stored);
  if (storedExp && storedExp * 1000 > Date.now() + 1000) {
    await tm.load();
  }
}

function broadcast(type: "TOKEN_REFRESHED" | "LOGOUT"): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type, timestamp: Date.now() });
    channel.close();
  } catch {
    /* 广播失败不影响正确性：刷新前会重读存储 */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Web Locks 优先；不支持时用 localStorage 租约。失败抛 transient（fail-closed）。 */
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LEASE_WAIT_MS);
    try {
      return await navigator.locks.request(
        LOCK_NAME,
        { signal: controller.signal },
        fn,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new TokenRefreshError("transient", "等待刷新锁超时");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  if (typeof localStorage === "undefined") {
    throw new TokenRefreshError("transient", "当前环境没有可用的刷新锁");
  }

  const key = `${LOCK_NAME}:lease`;
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + LEASE_WAIT_MS;

  while (Date.now() < deadline) {
    const raw = localStorage.getItem(key);
    let held = false;
    if (raw) {
      try {
        const lease = JSON.parse(raw) as { owner?: string; expiresAt?: number };
        held = typeof lease.expiresAt === "number" && lease.expiresAt > Date.now();
      } catch {
        held = false;
      }
    }
    if (!held) {
      localStorage.setItem(
        key,
        JSON.stringify({ owner, expiresAt: Date.now() + LEASE_TTL_MS }),
      );
      const check = localStorage.getItem(key);
      try {
        if ((JSON.parse(check ?? "{}") as { owner?: string }).owner === owner) {
          try {
            return await fn();
          } finally {
            const current = localStorage.getItem(key);
            try {
              if ((JSON.parse(current ?? "{}") as { owner?: string }).owner === owner) {
                localStorage.removeItem(key);
              }
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* 解析失败，重试 */
      }
    }
    await sleep(100);
  }

  throw new TokenRefreshError("transient", "等待刷新锁超时");
}

async function requestRefresh(
  autional: Autional,
  refreshToken: string,
): Promise<RefreshOutcome> {
  const tm = autional.tokenManager;
  const mode: "password" | "sso" =
    tm.getAuthMode() === "sso" ? "sso" : "password";
  const base = apiBase(autional);
  const url =
    mode === "sso"
      ? `${base}/oauth/api/v1/oauth/refresh`
      : `${base}/identity/api/v1/auth/refresh`;

  const headers: Record<string, string> = {};
  let body: string;
  if (mode === "sso") {
    const clientId =
      tm.getOAuthClientId() || process.env.NEXT_PUBLIC_AUTIONAL_APP_ID || "";
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    if (clientId) params.set("client_id", clientId);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = params.toString();
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ refresh_token: refreshToken });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return classifyRefresh(mode, res.status, parsed);
  } catch (err) {
    return { ok: false, issue: "transient", message: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function doRefresh(autional: Autional, force: boolean): Promise<string> {
  const tm = autional.tokenManager;

  return withRefreshLock(async () => {
    // 冷启动时内存为空，必须先载入持久化 token 才能拿到 refresh token；
    // 已有内存 token 时只做“按 exp 单调合并”，避免倒退。
    if (!tm.getRefreshToken()) {
      await tm.load();
    } else {
      await mergeFromStorage(autional);
    }

    const current = tm.getAccessToken();
    if (current && !force) return current;

    const refreshToken = tm.getRefreshToken();
    if (!refreshToken) {
      throw new TokenRefreshError("expired", "没有可用的 refresh token");
    }

    const outcome = await requestRefresh(autional, refreshToken);
    if (!outcome.ok) {
      if (outcome.issue === "transient" || outcome.issue === "config") {
        throw new TokenRefreshError(outcome.issue, outcome.message ?? "刷新暂时失败");
      }
      // 凭证确实失效：清理并通知其他标签
      tm.clear();
      await tm.persist();
      broadcast("LOGOUT");
      throw new TokenRefreshError(
        outcome.issue,
        outcome.message ?? "会话已失效",
      );
    }

    // 刷新期间发生登出/换号：丢弃本次结果，避免“复活”
    if (tm.getRefreshToken() !== refreshToken) {
      const latest = tm.getAccessToken();
      if (latest) return latest;
      throw new TokenRefreshError("expired", "会话已结束");
    }

    const nextRefreshToken = outcome.refreshToken ?? refreshToken;
    tm.setTokens(outcome.accessToken, nextRefreshToken, outcome.expiresIn);
    await tm.persist();

    // persist() 内部会吞错，这里做一次写后读校验
    const stored = await readStoredToken(tm);
    if (stored !== outcome.accessToken) {
      console.warn("[token] 持久化校验失败，其他标签页可能读到旧 token");
    }

    broadcast("TOKEN_REFRESHED");
    return outcome.accessToken;
  });
}

/** 在 Autional 实例上接管唯一刷新入口（幂等）。 */
export function installTokenSession(autional: Autional): void {
  if (installed.has(autional)) return;
  installed.add(autional);

  const config = (autional as unknown as {
    config?: { dpop?: boolean; useCookie?: boolean };
  }).config;
  // DPoP / cookie 模式下不接管，交给 SDK 原实现，避免破坏其安全语义
  if (config?.dpop || config?.useCookie) return;

  const original = (autional as unknown as {
    refreshSession: () => Promise<void>;
  }).refreshSession;

  (autional as unknown as { refreshSession: () => Promise<void> }).refreshSession =
    async () => {
      await doRefresh(autional, false);
    };

  // 保留原实现引用，便于将来回退/诊断（不主动调用）
  void original;
}

/** 取一个可用 token；失败时返回可分类的原因，不抛异常。 */
export async function ensureToken(
  autional: Autional,
  options: { force?: boolean } = {},
): Promise<EnsureTokenResult> {
  const force = options.force === true;
  const tm = autional.tokenManager;

  if (!force) {
    const current = tm.getAccessToken();
    if (current) return { ok: true, token: current };
  }

  try {
    const token = await doRefresh(autional, force);
    return { ok: true, token };
  } catch (err) {
    if (err instanceof TokenRefreshError) {
      return { ok: false, issue: err.issue, error: err };
    }
    return { ok: false, issue: "transient", error: err };
  }
}
