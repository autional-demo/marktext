/**
 * Public types for @autional/ai-auth.
 *
 * The BFF never persists OAuth tokens. The session cookie carries only the
 * minimum identity: issuer, subject, tenant, email and timestamps.
 */
/** OAuth token endpoint response (only the fields the BFF consumes). */
interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
}
/** Verified OIDC ID Token claims (subset). */
interface IdTokenClaims {
    iss: string;
    sub: string;
    aud: string | string[];
    exp: number;
    iat: number;
    nonce?: string;
    tenant_id?: string;
    email?: string;
    email_verified?: boolean;
}
/** OIDC userinfo response (subset). */
interface UserInfoResponse {
    sub: string;
    email?: string;
    email_verified?: boolean;
    [key: string]: unknown;
}
/** BFF session identity. Never contains access/refresh/ID tokens. */
interface AiSession {
    iss: string;
    sub: string;
    tenantId: string;
    clientId: string;
    email?: string;
    emailVerified?: boolean;
    iat: number;
    exp: number;
    idleExp: number;
}
/** Consent-status response from the platform internal endpoint. */
interface ConsentStatus {
    active: boolean;
    granted_at?: string;
    epoch?: number;
}
/** Optional shared cache (Cloudflare KV, Redis adapter, etc.). */
interface ConsentCache {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
}
interface InternalJwtConfig {
    /** `iss` of the BFF-issued internal token. */
    issuer: string;
    /** `aud` the AI API expects. */
    audience: string;
    /** PKCS#8 PEM (RSA) private key. Keep it in the platform secret store. */
    privateKeyPkcs8: string;
    /** JWKS key id; the AI API resolves the public key by this kid. */
    kid: string;
    /** Lifetime, seconds. Clamped to 60. */
    ttlSeconds?: number;
}
interface AiAuthEndpoints {
    authorize: string;
    token: string;
    userinfo: string;
    jwks: string;
}
/** Platform identity endpoints used by the embedded (no-redirect) flow. */
interface AiIdentityConfig {
    /** Identity API base, e.g. `https://api.autional.cn/bff`. */
    api: string;
    /** Tenant that owns QR/email login (the union tenant). */
    tenantId: string;
    /** Internal consent-create endpoint. */
    consentCreate: {
        endpoint: string;
        apiKey: string;
    };
    /** Scopes recorded on the consent row. Default `['openid', 'email']`. */
    scopes?: string[];
}
interface AiEmbedHandlers {
    sendEmail(request: Request): Promise<Response>;
    loginEmail(request: Request): Promise<Response>;
    qrInitiate(request: Request): Promise<Response>;
    qrStatus(request: Request): Promise<Response>;
    qrRevoke(request: Request): Promise<Response>;
}
interface AiAuthConfig {
    /** OIDC issuer, e.g. https://api.autional.cn (no trailing slash). */
    issuer: string;
    clientId: string;
    clientSecret: string;
    /** Registered callback, e.g. https://www.autional.cn/api/auth/callback. */
    redirectUri: string;
    /** AI API resource used as the JWT access token `aud`. */
    resource: string;
    /** Requested scopes. Default: ['openid', 'email']. */
    scopes?: string[];
    /**
     * Exact endpoint allowlist as `scheme://host/path` entries. Every discovered
     * (or configured) endpoint must match one entry. Required unless `endpoints`
     * is provided together with `allowedEndpointOrigins`.
     */
    endpointAllowlist?: string[];
    /** Explicit endpoints; when omitted they are resolved via OIDC discovery. */
    endpoints?: AiAuthEndpoints;
    /** Secret used to encrypt state/session cookies. At least 32 characters. */
    sessionSecret: string;
    /** Absolute session lifetime. Default 8h. */
    sessionAbsoluteTtlSeconds?: number;
    /** Sliding idle lifetime. Default 30m. */
    sessionIdleTtlSeconds?: number;
    /** OAuth state lifetime. Default 10m. */
    stateTtlSeconds?: number;
    /**
     * Embedded (no-redirect) login: customer pages call this BFF's
     * `/api/auth/embed/*` directly. Omit to keep OAuth-only behavior.
     */
    identity?: AiIdentityConfig;
    /** Platform internal endpoint for revocation checks. */
    consentStatus?: {
        endpoint: string;
        apiKey: string;
        /** Cache TTL for active consent. Default 60s; 0 disables caching. */
        cacheTtlSeconds?: number;
        cache?: ConsentCache;
    };
    /** Only same-origin paths under these prefixes may be used as `next`. Default ['/ai']. */
    allowedNextPrefixes?: string[];
    /** Defaults to `__Host-ai`. Use `ai` only for local http development. */
    cookiePrefix?: string;
    /** Set false only for local http development. Default true. */
    secureCookies?: boolean;
    /** Allow http endpoints. Set true only for local development. Default false. */
    allowInsecureHttp?: boolean;
    /** Optional BFF -> AI API internal JWT. */
    internalJwt?: InternalJwtConfig;
    /** Require a verified email from userinfo. Default true. */
    requireEmail?: boolean;
    /** Injectable fetch (tests, instrumentation). */
    fetch?: typeof fetch;
    /** Optional observability hook; must never throw into the auth flow. */
    onError?: (error: unknown, context: string) => void;
}
interface AiUser {
    iss: string;
    sub: string;
    tenantId: string;
    email?: string;
    emailVerified?: boolean;
}
interface AiAuth {
    /** Dispatch `/api/auth/{login,callback,session,logout,embed/*}` by pathname. */
    route(request: Request): Promise<Response>;
    /** Embedded passwordless endpoints (503 when `identity` is not configured). */
    embed: AiEmbedHandlers;
    login(request: Request): Promise<Response>;
    callback(request: Request): Promise<Response>;
    session(request: Request): Promise<Response>;
    logout(request: Request): Promise<Response>;
    /** Read the session from the request; returns null when invalid/revoked. */
    getUser(request: Request): Promise<AiSession | null>;
    /** Mint a short-lived internal JWT for the AI API; null when not configured. */
    mintInternalToken(session: AiSession): Promise<string | null>;
}

/**
 * BFF login handler: OAuth 2.0 Authorization Code + PKCE (S256), OIDC nonce,
 * encrypted HttpOnly session, consent-revocation check and an optional
 * BFF→AI internal JWT.
 *
 * Runtime target: any Web `Request`/`Response` environment (Cloudflare Workers,
 * Vercel Edge, Node 20+). No tokens are persisted anywhere.
 */

interface CreateAiAuthHooks {
    onError?: (error: unknown, context: string) => void;
}
declare function createAiAuth(configInput: AiAuthConfig, hooks?: CreateAiAuthHooks): AiAuth;

/**
 * Runtime adapters.
 *
 * - Cloudflare Workers / Vercel Edge: the Web `Request`/`Response` handler is
 *   used directly.
 * - Node (including Vercel Node functions): convert IncomingMessage/ServerResponse
 *   to/from the Web standard objects.
 */

type WebHandler = (request: Request) => Promise<Response>;
/** Cloudflare Workers `export default { fetch }`. */
declare function createCloudflareHandler(auth: AiAuth): {
    fetch: WebHandler;
};
/** Vercel Edge / Next.js App Router `export default`. */
declare function createVercelEdgeHandler(auth: AiAuth): WebHandler;
interface NodeIncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
}
interface NodeServerResponse {
    statusCode: number;
    setHeader(name: string, value: string | string[]): void;
    end(body?: Uint8Array | string): void;
}
/** Vercel Node runtime / plain Node `(req, res)` handler. */
declare function createNodeHandler(auth: AiAuth): (req: NodeIncomingMessage, res: NodeServerResponse) => Promise<void>;

/**
 * Consent revocation check (B6).
 *
 * The platform's `GET /internal/oauth/consent-status` reflects the consent row's
 * soft-delete state. Any failure — network, HTTP, malformed body, `active !== true`
 * — is treated as revoked (fail-closed). Active results are cached for a short
 * TTL (default 60s), which bounds revocation propagation to ≤5 minutes together
 * with the session check interval.
 */

/** Test hook: clears the in-process cache. */
declare function clearConsentCache(): void;

/**
 * OIDC discovery, endpoint allowlisting and ID Token verification.
 *
 * All network failures are fail-closed: a login cannot proceed on partial
 * discovery data, an unlisted endpoint, a non-RS256 token or a bad nonce.
 */

/** Test hook: clears the process-wide JWKS cache. */
declare function clearOidcCache(): void;

export { type AiAuth, type AiAuthConfig, type AiAuthEndpoints, type AiEmbedHandlers, type AiIdentityConfig, type AiSession, type AiUser, type ConsentCache, type ConsentStatus, type IdTokenClaims, type InternalJwtConfig, type TokenResponse, type UserInfoResponse, clearConsentCache, clearOidcCache, createAiAuth, createCloudflareHandler, createNodeHandler, createVercelEdgeHandler };
