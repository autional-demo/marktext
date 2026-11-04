import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const ISSUER =
  process.env.AUTIONAL_ISSUER ??
  process.env.NEXT_PUBLIC_AUTIONAL_ISSUER ??
  "https://api.autional.cn";

const JWKS_URL = process.env.AUTIONAL_JWKS_URL ?? `${ISSUER}/.well-known/jwks.json`;

/** token 里没有 tenant_id 时的兜底（单租户部署）。 */
const DEFAULT_TENANT_ID =
  process.env.AUTIONAL_TENANT_ID ??
  process.env.NEXT_PUBLIC_AUTIONAL_TENANT_ID ??
  "";

let keySet: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwks() {
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(JWKS_URL), {
      cacheMaxAge: 60 * 60 * 1000,
      cooldownDuration: 30 * 1000,
      timeoutDuration: 5 * 1000,
    });
  }
  return keySet;
}

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

/**
 * 校验 Authorization: Bearer <jwt>。
 *
 * 只信签名 + iss + exp，不信前端传来的任何 id。
 * 算法固定 RS256，避免 alg 混淆（包括 alg: none）。
 */
/**
 * 可选：限制可接受的 iss。真实 token 的 iss 是 "identity-service"，
 * SSO 会话可能不同，因此默认不校验 iss，只依赖签名 + exp。
 * 需要收紧时设置 AUTIONAL_ALLOWED_ISSUERS（逗号分隔）。
 */
const ALLOWED_ISSUERS = (process.env.AUTIONAL_ALLOWED_ISSUERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export async function requireCaller(req: Request): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new HttpError(401, "缺少 Bearer token");

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(match[1], jwks(), {
      algorithms: ["RS256"],
      clockTolerance: 5,
    }));
  } catch {
    throw new HttpError(401, "token 无效或已过期");
  }

  if (
    ALLOWED_ISSUERS.length > 0 &&
    typeof payload.iss === "string" &&
    !ALLOWED_ISSUERS.includes(payload.iss)
  ) {
    throw new HttpError(401, "token 签发方不受信任");
  }

  const userId =
    typeof payload.sub === "string" && payload.sub
      ? payload.sub
      : typeof payload.user_id === "string" && payload.user_id
        ? payload.user_id
        : "";
  if (!userId) throw new HttpError(401, "token 缺少 sub");

  const tenantId =
    (typeof payload.tenant_id === "string" && payload.tenant_id) || DEFAULT_TENANT_ID;

  return { userId, tenantId };
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
