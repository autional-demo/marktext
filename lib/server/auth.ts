import { createHash } from "node:crypto";
import { decodeJwt, type JWTPayload } from "jose";

/**
 * 服务端身份校验。
 *
 * 为什么不用 JWKS 验签：
 * 真实的 identity access token 头部没有 kid，且签名密钥不在
 * `/.well-known/jwks.json` 里（该 JWKS 服务的是 id_token）。实测验签失败。
 *
 * 因此改为：先本地解码检查 exp，再调用身份服务的 /me 做权威校验。
 * /me 返回 200 才算有效；token 与用户 id 必须一致。
 * 结果按 token 哈希缓存 60 秒，避免自动保存时每次都打网络。
 */

const API_BASE = (
  process.env.AUTIONAL_API_BASE ?? "https://api.autional.cn/bff"
).replace(/\/$/, "");

const ME_URL =
  process.env.AUTIONAL_ME_URL ?? `${API_BASE}/identity/api/v1/auth/me`;

const DEFAULT_TENANT_ID =
  process.env.AUTIONAL_TENANT_ID ??
  process.env.NEXT_PUBLIC_AUTIONAL_TENANT_ID ??
  "";

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 500;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface Caller {
  userId: string;
  tenantId: string;
}

interface CacheEntry {
  caller: Caller;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function remember(token: string, caller: Caller, expSeconds: number): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey(token), {
    caller,
    expiresAt: Math.min(Date.now() + CACHE_TTL_MS, expSeconds * 1000),
  });
}

export async function requireCaller(req: Request): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new HttpError(401, "缺少 Bearer token");

  const token = match[1];

  let payload: JWTPayload;
  try {
    payload = decodeJwt(token);
  } catch {
    throw new HttpError(401, "token 格式不正确");
  }

  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (!exp || exp * 1000 + 5000 < Date.now()) {
    throw new HttpError(401, "token 已过期");
  }

  const hit = cache.get(cacheKey(token));
  if (hit && hit.expiresAt > Date.now()) return hit.caller;

  let res: Response;
  try {
    res = await fetch(ME_URL, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    throw new HttpError(503, "认证服务暂时不可用");
  }

  if (res.status === 401 || res.status === 403) {
    throw new HttpError(401, "token 无效或已过期");
  }
  if (!res.ok) {
    throw new HttpError(503, "认证服务暂时不可用");
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: Record<string, unknown> }
    | Record<string, unknown>
    | null;
  const data = ((body as { data?: Record<string, unknown> })?.data ??
    body) as Record<string, unknown> | null;

  const verifiedId =
    typeof data?.id === "string"
      ? data.id
      : typeof data?.user_id === "string"
        ? data.user_id
        : "";
  if (!verifiedId) throw new HttpError(401, "无法确认用户身份");

  const claimedId =
    typeof payload.sub === "string"
      ? payload.sub
      : typeof payload.user_id === "string"
        ? payload.user_id
        : "";
  if (claimedId && claimedId !== verifiedId) {
    throw new HttpError(401, "token 与用户不匹配");
  }

  const tenantId =
    (typeof payload.tenant_id === "string" && payload.tenant_id) ||
    DEFAULT_TENANT_ID;

  const caller: Caller = { userId: verifiedId, tenantId };
  remember(token, caller, exp);
  return caller;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof Error && err.message.includes("CONTENT_ENCRYPTION_KEY")) {
    console.error("[api] 加密密钥未配置", err);
    return Response.json({ error: "服务端加密未配置" }, { status: 500 });
  }
  console.error("[api] unexpected error", err);
  return Response.json({ error: "服务器内部错误" }, { status: 500 });
}
