import { createAiAuth, type AiAuth } from "@autional/ai-auth";

/**
 * BFF-side AI auth (embedded QR / email-code login).
 *
 * The Worker holds the platform internal API key and the session encryption
 * secret. The browser only ever receives the encrypted HttpOnly session cookie.
 * OAuth fields are still required by the SDK config but the embedded mode does
 * not use the token endpoint.
 */

const ISSUER = (process.env.AUTIONAL_ISSUER ?? "https://api.autional.cn").replace(/\/+$/, "");
const IDENTITY_API = (
  process.env.AUTIONAL_API_BASE ?? "https://api.autional.cn/bff"
).replace(/\/+$/, "");
const TENANT_ID =
  process.env.AUTIONAL_TENANT_ID ??
  process.env.NEXT_PUBLIC_AUTIONAL_TENANT_ID ??
  "";
const APP_ORIGIN = (
  process.env.AUTIONAL_APP_ORIGIN ?? "https://marktext.denglu.dev"
).replace(/\/+$/, "");
const CLIENT_ID =
  process.env.AUTIONAL_APP_ID ??
  process.env.NEXT_PUBLIC_AUTIONAL_APP_ID ??
  "client-Ost6T4zMRKoh";

const INSECURE_COOKIES = process.env.AI_AUTH_INSECURE_COOKIES === "1";
export const SESSION_COOKIE_PREFIX = INSECURE_COOKIES
  ? "marktext"
  : "__Host-marktext";
export const SESSION_COOKIE_NAME = `${SESSION_COOKIE_PREFIX}-session`;

let cached: AiAuth | null = null;

export function getAiAuth(): AiAuth {
  if (cached) return cached;

  const sessionSecret = process.env.AI_AUTH_SESSION_SECRET ?? "";
  const internalApiKey = process.env.AI_BFF_API_KEY ?? "";
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("AI_AUTH_SESSION_SECRET 未配置或长度不足 32 字符");
  }
  if (!internalApiKey) throw new Error("AI_BFF_API_KEY 未配置");
  if (!TENANT_ID) throw new Error("AUTIONAL_TENANT_ID 未配置");

  const consentEndpoint = `${IDENTITY_API}/oauth/api/v1/internal/oauth/consents`;
  const statusEndpoint = `${IDENTITY_API}/oauth/api/v1/internal/oauth/consent-status`;

  cached = createAiAuth({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    // Embedded mode never calls the token endpoint; the SDK still requires a
    // non-empty value for OAuth compatibility.
    clientSecret: process.env.AI_AUTH_CLIENT_SECRET ?? "embed-only-unused",
    redirectUri: `${APP_ORIGIN}/oauth/callback`,
    resource: `${APP_ORIGIN}/api`,
    sessionSecret,
    cookiePrefix: SESSION_COOKIE_PREFIX,
    secureCookies: !INSECURE_COOKIES,
    allowInsecureHttp: INSECURE_COOKIES,
    requireEmail: false,
    identity: {
      api: IDENTITY_API,
      tenantId: TENANT_ID,
      consentCreate: { endpoint: consentEndpoint, apiKey: internalApiKey },
      scopes: ["openid", "email"],
    },
    consentStatus: {
      endpoint: statusEndpoint,
      apiKey: internalApiKey,
      cacheTtlSeconds: 60,
    },
  });
  return cached;
}
