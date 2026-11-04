/**
 * Token 会话加固单测：分类 + 并发刷新。
 * 运行：npm run test:token
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRefresh,
  decodeJwtExp,
  ensureToken,
  installTokenSession,
  storageIsNewer,
} from "../lib/token-session";

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(exp: number): string {
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`;
}

function future(seconds = 300): string {
  return jwt(Math.floor(Date.now() / 1000) + seconds);
}

function past(seconds = 300): string {
  return jwt(Math.floor(Date.now() / 1000) - seconds);
}

test("decodeJwtExp", () => {
  const exp = Math.floor(Date.now() / 1000) + 10;
  assert.equal(decodeJwtExp(jwt(exp)), exp);
  assert.equal(decodeJwtExp("bad"), null);
});

test("classifyRefresh: 200 + 合法 token", () => {
  const token = future();
  const out = classifyRefresh("password", 200, {
    code: 0,
    data: { access_token: token, refresh_token: "rt2", expires_in: 300 },
  });
  assert.ok(out.ok);
  if (out.ok) assert.equal(out.accessToken, token);
});

test("classifyRefresh: 200 但缺 token / 非法 token", () => {
  assert.equal(classifyRefresh("password", 200, { code: 0, data: {} }).ok, false);
  const bad = classifyRefresh("password", 200, {
    code: 0,
    data: { access_token: "not-a-jwt", refresh_token: "rt" },
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.issue, "transient");
});

test("classifyRefresh: identity 40000502 reused / revoked", () => {
  const reused = classifyRefresh("password", 401, {
    code: 40000502,
    message: "refresh token has been reused",
  });
  assert.equal(reused.ok, false);
  if (!reused.ok) assert.equal(reused.issue, "revoked");

  const revoked = classifyRefresh("password", 401, {
    code: 40000502,
    message: "refresh token has been revoked",
  });
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal(revoked.issue, "expired");
});

test("classifyRefresh: 401 / 429 / 500 / 未知", () => {
  const expired = classifyRefresh("password", 401, { code: 61000104 });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.issue, "expired");

  for (const status of [429, 500, 502, 503, 400]) {
    const out = classifyRefresh("password", status, { message: "x" });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.issue, "transient", `status ${status}`);
  }
});

test("classifyRefresh: sso invalid_grant reused / expired / invalid_client", () => {
  const reused = classifyRefresh("sso", 400, {
    error: "invalid_grant",
    error_description: "refresh token reused",
  });
  assert.equal(reused.ok, false);
  if (!reused.ok) assert.equal(reused.issue, "revoked");

  const expired = classifyRefresh("sso", 400, {
    error: "invalid_grant",
    error_description: "refresh token expired",
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.issue, "expired");

  const client = classifyRefresh("sso", 401, { error: "invalid_client" });
  assert.equal(client.ok, false);
  if (!client.ok) assert.equal(client.issue, "config");
});

test("storageIsNewer: 新者胜，旧者不倒退", () => {
  const old = past(10);
  const fresh = future(100);
  assert.equal(storageIsNewer(fresh, old), true);
  assert.equal(storageIsNewer(old, fresh), false);
  assert.equal(storageIsNewer(fresh, null), true);
  assert.equal(storageIsNewer(null, fresh), false);
});

/* ---------------- 并发刷新 ---------------- */

function installFakeNavigatorLock(): void {
  let busy = false;
  const locks = {
    async request(
      _name: string,
      arg1: unknown,
      arg2?: unknown,
    ): Promise<unknown> {
      const fn = (typeof arg1 === "function" ? arg1 : arg2) as () => Promise<unknown>;
      while (busy) {
        await new Promise((r) => setTimeout(r, 2));
      }
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { locks },
    configurable: true,
    writable: true,
  });
}

function makeFakeAutional(initialAccess: string, refreshToken = "rt-1") {
  let store = { accessToken: initialAccess, refreshToken };

  const storage = {
    getItem(): string {
      return JSON.stringify(store);
    },
    setItem(_key: string, value: string): void {
      const parsed = JSON.parse(value) as {
        accessToken?: string;
        refreshToken?: string;
      };
      store = {
        accessToken: parsed.accessToken ?? null,
        refreshToken: parsed.refreshToken ?? null,
      } as typeof store;
    },
  };

  const tm = {
    get store() {
      return store;
    },
    storage,
    storageKey: (key: string) => key,
    getAccessToken(): string | null {
      const token = store.accessToken;
      const exp = decodeJwtExp(token);
      return token && exp && exp * 1000 > Date.now() ? token : null;
    },
    getRefreshToken(): string | null {
      return store.refreshToken;
    },
    getAuthMode() {
      return "password" as const;
    },
    getOAuthClientId() {
      return null;
    },
    setTokens(accessToken: string, nextRefreshToken: string): void {
      store = { accessToken, refreshToken: nextRefreshToken };
    },
    async persist(): Promise<void> {},
    async load(): Promise<void> {},
    clear(): void {
      store = { accessToken: null, refreshToken: null };
    },
  };

  return {
    tokenManager: tm,
    config: { apiUrl: "/bff" },
    refreshSession: async () => undefined,
  };
}

test("并发 ensureToken 只触发一次刷新", async () => {
  installFakeNavigatorLock();
  let calls = 0;
  const fresh = future(600);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return new Response(
      JSON.stringify({
        code: 0,
        data: { access_token: fresh, refresh_token: "rt-2", expires_in: 300 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const fake = makeFakeAutional(past());
    installTokenSession(fake as never);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensureToken(fake as never)),
    );
    assert.equal(calls, 1, "10 个并发请求应只刷新一次");
    assert.ok(results.every((r) => r.ok));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("网络失败返回 transient 且不清 refresh token", async () => {
  installFakeNavigatorLock();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;

  try {
    const fake = makeFakeAutional(past(), "rt-keep");
    installTokenSession(fake as never);

    const result = await ensureToken(fake as never);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issue, "transient");
    assert.equal(fake.tokenManager.getRefreshToken(), "rt-keep");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("复用失败清 token 并返回 revoked", async () => {
  installFakeNavigatorLock();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ code: 40000502, message: "refresh token reused" }),
      { status: 401, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  try {
    const fake = makeFakeAutional(past(), "rt-1");
    installTokenSession(fake as never);

    const result = await ensureToken(fake as never);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issue, "revoked");
    assert.equal(fake.tokenManager.getRefreshToken(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
