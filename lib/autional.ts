export const AUTIONAL_ISSUER =
  process.env.NEXT_PUBLIC_AUTIONAL_ISSUER ?? "https://api.autional.cn";
export const AUTIONAL_API_URL =
  process.env.NEXT_PUBLIC_AUTIONAL_API_URL ?? "https://api.autional.cn/bff";

/**
 * 租户 ID（ULID）。issuer 为共享域名，SDK 无法从子域推导，必须显式传入。
 */
export const AUTIONAL_TENANT_ID =
  process.env.NEXT_PUBLIC_AUTIONAL_TENANT_ID ?? "";

/** SSO 应用客户端 ID；未配置时只显示邮箱密码登录。 */
export const AUTIONAL_APP_ID =
  process.env.NEXT_PUBLIC_AUTIONAL_APP_ID ?? "";

export const SSO_ENABLED = AUTIONAL_APP_ID.length > 0;

export const AUTHORIZE_URL =
  process.env.NEXT_PUBLIC_AUTIONAL_AUTHORIZE_URL ??
  "https://auth.autional.cn/oauth/api/v1/oauth/authorize";

export const CALLBACK_PATH = "/oauth/callback";

export function callbackUri(): string {
  if (typeof window === "undefined") return CALLBACK_PATH;
  return `${window.location.origin}${CALLBACK_PATH}`;
}

export const autionalConfig = {
  appId: AUTIONAL_APP_ID || undefined,
  issuer: AUTIONAL_ISSUER,
  apiUrl: AUTIONAL_API_URL,
  tenantId: AUTIONAL_TENANT_ID,
  storagePrefix: "marktext-web",
  syncTabs: true,
} as const;
