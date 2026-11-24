"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  clearConsentCache: () => clearConsentCache,
  clearOidcCache: () => clearOidcCache,
  createAiAuth: () => createAiAuth,
  createCloudflareHandler: () => createCloudflareHandler,
  createNodeHandler: () => createNodeHandler,
  createVercelEdgeHandler: () => createVercelEdgeHandler
});
module.exports = __toCommonJS(index_exports);

// src/crypto.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function utf8(value) {
  return encoder.encode(value);
}
function fromUtf8(value) {
  return decoder.decode(value);
}
function randomBytes(length) {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}
async function sha256Base64Url(value) {
  return base64UrlEncode(await sha256(utf8(value)));
}
async function aesKey(secret) {
  const digest = await sha256(utf8(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptJson(secret, value) {
  const key = await aesKey(secret);
  const iv = randomBytes(12);
  const plaintext = utf8(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  );
  return base64UrlEncode(concatBytes(iv, ciphertext));
}
async function decryptJson(secret, value) {
  try {
    const bytes = base64UrlDecode(value);
    if (bytes.length < 12 + 16) return null;
    const key = await aesKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12)
    );
    return JSON.parse(fromUtf8(new Uint8Array(plaintext)));
  } catch {
    return null;
  }
}
async function verifyRs256(jwk, signingInput, signature) {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
  } catch {
    return false;
  }
}
async function importRs256PrivateKey(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/gu, "").replace(/-----END [^-]+-----/gu, "").replace(/\s+/gu, "");
  const der = base64UrlDecode(body.replace(/\+/g, "-").replace(/\//g, "_"));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
async function signRs256(key, signingInput) {
  return new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, signingInput));
}

// src/cookies.ts
function readCookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return null;
}
function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAgeSeconds !== void 0) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}
function clearCookie(name, options = {}) {
  return serializeCookie(name, "", { ...options, maxAgeSeconds: 0 });
}
function appendSetCookie(headers, cookie) {
  headers.append("Set-Cookie", cookie);
}

// src/consent.ts
var memoryCache = /* @__PURE__ */ new Map();
function cacheKey(session) {
  return `${session.iss}|${session.tenantId}|${session.sub}|${session.clientId}`;
}
function parseStatus(body) {
  if (!body || typeof body !== "object") return null;
  const root = body;
  const data = root.data && typeof root.data === "object" ? root.data : root;
  if (typeof data.active !== "boolean") return null;
  return {
    active: data.active,
    granted_at: typeof data.granted_at === "string" ? data.granted_at : void 0,
    epoch: typeof data.epoch === "number" ? data.epoch : void 0
  };
}
function createConsentChecker(config) {
  const settings = config.consentStatus;
  if (!settings) return null;
  const fetcher = config.fetch ?? fetch;
  const cacheTtlMs = Math.max(0, (settings.cacheTtlSeconds ?? 60) * 1e3);
  return async (session) => {
    const key = cacheKey(session);
    const now = Date.now();
    const cached = memoryCache.get(key);
    if (cached && cached.expiresAt > now) return cached.active;
    if (settings.cache) {
      try {
        const shared = await settings.cache.get(key);
        if (shared === "1") {
          if (cacheTtlMs > 0) memoryCache.set(key, { active: true, expiresAt: now + cacheTtlMs });
          return true;
        }
      } catch {
      }
    }
    let active = false;
    try {
      const url = new URL(settings.endpoint);
      url.searchParams.set("user_id", session.sub);
      url.searchParams.set("client_id", session.clientId);
      const response = await fetcher(url.toString(), {
        headers: {
          accept: "application/json",
          "x-api-key": settings.apiKey,
          "x-tenant-id": session.tenantId
        }
      });
      if (response.ok) {
        const status = parseStatus(await response.json());
        active = status?.active === true;
      }
    } catch {
      active = false;
    }
    if (cacheTtlMs > 0 && active) {
      memoryCache.set(key, { active, expiresAt: now + cacheTtlMs });
      if (settings.cache) {
        try {
          await settings.cache.set(key, "1", Math.floor(cacheTtlMs / 1e3));
        } catch {
        }
      }
    } else if (!active) {
      memoryCache.delete(key);
    }
    return active;
  };
}
function clearConsentCache() {
  memoryCache.clear();
}

// src/session.ts
var SESSION_COOKIE_SUFFIX = "session";
function sessionCookieName(prefix) {
  return `${prefix}-${SESSION_COOKIE_SUFFIX}`;
}
function newSession(input) {
  const now = Math.floor(Date.now() / 1e3);
  return {
    iss: input.iss,
    sub: input.sub,
    tenantId: input.tenantId,
    clientId: input.clientId,
    ...input.email ? { email: input.email } : {},
    ...input.emailVerified !== void 0 ? { emailVerified: input.emailVerified } : {},
    iat: now,
    exp: now + input.ttl.absoluteSeconds,
    idleExp: now + input.ttl.idleSeconds
  };
}
async function sealSession(secret, session) {
  return encryptJson(secret, { v: 1, session });
}
async function openSession(secret, value) {
  const payload = await decryptJson(secret, value);
  if (!payload || payload.v !== 1 || !payload.session) return null;
  const session = payload.session;
  if (typeof session.iss !== "string" || typeof session.sub !== "string" || typeof session.tenantId !== "string" || typeof session.clientId !== "string" || typeof session.iat !== "number" || typeof session.exp !== "number" || typeof session.idleExp !== "number") {
    return null;
  }
  return session;
}
function touchSession(session, idleSeconds) {
  const now = Math.floor(Date.now() / 1e3);
  if (session.exp <= now || session.idleExp <= now) return null;
  return { ...session, idleExp: now + idleSeconds };
}

// src/embed.ts
function trimSlash(value) {
  return value.replace(/\/+$/u, "");
}
function json(body, status = 200, headers) {
  const out = headers ?? new Headers();
  out.set("content-type", "application/json; charset=utf-8");
  out.set("cache-control", "no-store");
  out.set("x-content-type-options", "nosniff");
  out.set("referrer-policy", "no-referrer");
  out.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  return new Response(JSON.stringify(body), { status, headers: out });
}
function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
function report(ctx, error, context) {
  try {
    ctx.onError?.(error, context);
  } catch {
  }
}
function createEmbedHandlers(ctx) {
  const identity = ctx.identity;
  const identityBase = identity ? trimSlash(identity.api) : "";
  async function identityFetch(path, init = {}) {
    const res = await ctx.fetcher(`${identityBase}${path}`, init);
    const body = await res.json().catch(() => null);
    return { res, body };
  }
  async function identityMe(token, tenantId) {
    const { res, body } = await identityFetch("/identity/api/v1/auth/me", {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-tenant-id": tenantId
      }
    });
    if (res.status !== 200 || body?.code !== 0) return null;
    return body.data ?? null;
  }
  async function recordConsent(userId, tenantId) {
    if (!identity) throw new Error("embed is not configured");
    const res = await ctx.fetcher(identity.consentCreateUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": identity.internalApiKey,
        "x-tenant-id": tenantId
      },
      body: JSON.stringify({
        user_id: userId,
        client_id: ctx.clientId,
        scopes: identity.scopes ?? ["openid", "email"]
      })
    });
    const body = await res.json().catch(() => null);
    if (res.status !== 200 || body?.code !== 0) {
      throw new Error(`consent record failed: HTTP ${res.status}`);
    }
  }
  async function sessionResponse(token, emailHint) {
    const claims = decodeJwtPayload(token);
    const tenantId = typeof claims?.tenant_id === "string" ? claims.tenant_id : "";
    if (!tenantId) throw new Error("identity token has no tenant_id");
    const me = await identityMe(token, tenantId);
    if (!me?.id) throw new Error("identity /me failed");
    await recordConsent(String(me.id), tenantId);
    const email = typeof me.email === "string" && me.email ? me.email : emailHint;
    const emailVerified = typeof me.email_verified === "boolean" ? me.email_verified : me.emailVerified;
    const session = newSession({
      iss: ctx.issuer,
      sub: String(me.id),
      tenantId,
      clientId: ctx.clientId,
      ...email ? { email } : {},
      ...typeof emailVerified === "boolean" ? { emailVerified } : {},
      ttl: { absoluteSeconds: ctx.absoluteTtl, idleSeconds: ctx.idleTtl }
    });
    const sealed = await sealSession(ctx.sessionSecret, session);
    const headers = new Headers();
    appendSetCookie(
      headers,
      serializeCookie(sessionCookieName(ctx.cookiePrefix), sealed, {
        secure: ctx.secureCookies,
        httpOnly: true,
        sameSite: "Lax",
        path: "/"
      })
    );
    return json(
      {
        user: {
          sub: session.sub,
          email: session.email ?? null,
          tenantId: session.tenantId
        }
      },
      200,
      headers
    );
  }
  function notConfigured() {
    return identity ? null : json({ error: "embed_not_configured" }, 503);
  }
  async function sendEmail(request) {
    const missing = notConfigured();
    if (missing) return missing;
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? "").trim();
    if (!email) return json({ error: "email_required" }, 400);
    const { res, body: rb } = await identityFetch("/identity/api/v1/auth/send-verification-email", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, tenant_id: identity.tenantId })
    });
    if (res.status !== 200 || rb?.code !== 0) return json({ error: "send_failed" }, 502);
    return json({ ok: true });
  }
  async function loginEmail(request) {
    const missing = notConfigured();
    if (missing) return missing;
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? "").trim();
    const code = String(body?.code ?? "").trim();
    if (!email || !/^\d{6}$/u.test(code)) return json({ error: "invalid_input" }, 400);
    const { res, body: rb } = await identityFetch("/identity/api/v1/auth/login/email-code", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, code, tenant_id: identity.tenantId })
    });
    if (res.status !== 200 || rb?.code !== 0) {
      if (rb?.data?.requires_mfa || rb?.requires_mfa) return json({ error: "mfa_required" }, 401);
      return json({ error: "login_failed" }, 401);
    }
    const token = rb?.data?.access_token;
    if (typeof token !== "string" || !token) return json({ error: "login_failed" }, 502);
    try {
      return await sessionResponse(token, rb?.data?.user?.email || email);
    } catch (error) {
      report(ctx, error, "embed_email_session");
      return json({ error: "login_failed" }, 502);
    }
  }
  async function qrInitiate(request) {
    const missing = notConfigured();
    if (missing) return missing;
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const { res, body } = await identityFetch("/identity/api/v1/auth/qr-login/initiate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ tenant_id: identity.tenantId })
    });
    if (res.status !== 200 || body?.code !== 0) return json({ error: "qr_initiate_failed" }, 502);
    const data = body.data ?? {};
    return json({
      sessionToken: data.session_token,
      numberMatching: data.number_matching,
      expiresIn: data.expires_in ?? 300
    });
  }
  async function qrStatus(request) {
    const missing = notConfigured();
    if (missing) return missing;
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!token) return json({ error: "token_required" }, 400);
    const { res, body } = await identityFetch(
      `/identity/api/v1/auth/qr-login/status?token=${encodeURIComponent(token)}`,
      { headers: { accept: "application/json" } }
    );
    if (res.status !== 200 || body?.code !== 0) return json({ error: "qr_status_failed" }, 502);
    const data = body.data ?? {};
    const status = String(data.status || "pending");
    const out = {
      status,
      numberMatching: data.number_matching,
      superseded: data.superseded === true
    };
    if (status !== "confirmed") return json(out);
    if (!data.access_token) return json({ ...out, status: "no_token" });
    try {
      const response = await sessionResponse(data.access_token, data.user?.email);
      const payload = await response.json();
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ ...out, user: payload.user }), { status: 200, headers });
    } catch (error) {
      report(ctx, error, "embed_qr_session");
      return json({ error: "login_failed" }, 502);
    }
  }
  async function qrRevoke(request) {
    const missing = notConfigured();
    if (missing) return missing;
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await request.json().catch(() => null);
    const token = String(body?.token ?? "");
    if (token) {
      await identityFetch("/identity/api/v1/auth/qr-login/revoke", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ token })
      }).catch(() => void 0);
    }
    return json({ ok: true });
  }
  return { sendEmail, loginEmail, qrInitiate, qrStatus, qrRevoke };
}

// src/oidc.ts
var DISCOVERY_TTL_MS = 60 * 60 * 1e3;
var JWKS_TTL_MS = 10 * 60 * 1e3;
var CLOCK_LEEWAY_SECONDS = 60;
var OidcError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OidcError";
  }
};
function trimSlash2(value) {
  return value.replace(/\/+$/u, "");
}
function parseHttpsUrl(value, allowInsecure) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new OidcError(`invalid endpoint URL: ${value}`);
  }
  if (url.username || url.password || url.hash) {
    throw new OidcError(`endpoint URL must not contain userinfo/fragment: ${value}`);
  }
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    throw new OidcError(`endpoint must use https: ${value}`);
  }
  return url;
}
function normalizeEndpoint(value) {
  return trimSlash2(value);
}
function assertAllowed(endpoint, allowlist, allowInsecure) {
  const url = parseHttpsUrl(endpoint, allowInsecure);
  if (!allowlist || allowlist.length === 0) {
    return;
  }
  const normalized = normalizeEndpoint(endpoint);
  const ok = allowlist.some((entry) => normalizeEndpoint(entry) === normalized);
  if (!ok) throw new OidcError(`endpoint is not in allowlist: ${url.origin}${url.pathname}`);
}
function createEndpointResolver(config) {
  const fetcher = config.fetch ?? fetch;
  const allowInsecure = config.allowInsecureHttp === true;
  let cached = null;
  let inflight = null;
  const validate = (value) => {
    const urls = [value.authorize, value.token, value.userinfo, value.jwks];
    for (const item of urls) assertAllowed(item, config.endpointAllowlist, allowInsecure);
    if (!config.endpointAllowlist || config.endpointAllowlist.length === 0) {
      const issuerOrigin = new URL(config.issuer).origin;
      for (const item of urls) {
        const origin = new URL(item).origin;
        if (origin !== issuerOrigin) {
          throw new OidcError(`endpoint origin must equal issuer origin when no allowlist is set: ${origin}`);
        }
      }
    }
    return value;
  };
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        let value;
        if (config.endpoints) {
          value = config.endpoints;
        } else {
          const discoveryUrl = `${trimSlash2(config.issuer)}/.well-known/openid-configuration`;
          const response = await fetcher(discoveryUrl, { headers: { accept: "application/json" } });
          if (!response.ok) throw new OidcError(`discovery failed: HTTP ${response.status}`);
          const doc = await response.json();
          if (trimSlash2(doc.issuer ?? "") !== trimSlash2(config.issuer)) {
            throw new OidcError("discovery issuer mismatch");
          }
          if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint || !doc.jwks_uri) {
            throw new OidcError("discovery document is missing required endpoints");
          }
          value = {
            authorize: doc.authorization_endpoint,
            token: doc.token_endpoint,
            userinfo: doc.userinfo_endpoint,
            jwks: doc.jwks_uri
          };
        }
        const validated = validate(value);
        cached = { value: validated, expiresAt: Date.now() + DISCOVERY_TTL_MS };
        return validated;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}
var jwksCache = null;
function clearOidcCache() {
  jwksCache = null;
}
async function loadJwks(uri, fetcher, allowInsecure) {
  parseHttpsUrl(uri, allowInsecure);
  if (jwksCache && jwksCache.uri === uri && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetcher(uri, { headers: { accept: "application/json" } });
  if (!response.ok) throw new OidcError(`JWKS fetch failed: HTTP ${response.status}`);
  const doc = await response.json();
  if (!Array.isArray(doc.keys) || doc.keys.length === 0) throw new OidcError("JWKS contains no keys");
  jwksCache = { uri, keys: doc.keys, expiresAt: Date.now() + JWKS_TTL_MS };
  return doc.keys;
}
function decodeSegment(segment) {
  try {
    return JSON.parse(fromUtf8(base64UrlDecode(segment)));
  } catch {
    throw new OidcError("malformed JWT segment");
  }
}
async function verifyIdToken(options) {
  const parts = options.token.split(".");
  if (parts.length !== 3) throw new OidcError("ID token is not a JWT");
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeSegment(headerB64);
  if (header.alg !== "RS256") throw new OidcError("ID token alg must be RS256");
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) throw new OidcError("ID token is missing kid");
  const keys = await loadJwks(options.jwksUri, options.fetcher, options.allowInsecureHttp);
  const jwk = keys.find((key) => key.kid === kid && (key.alg === void 0 || key.alg === "RS256"));
  if (!jwk) throw new OidcError("no matching JWKS key for ID token kid");
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  if (!await verifyRs256(jwk, signingInput, signature)) {
    throw new OidcError("ID token signature verification failed");
  }
  const claims = decodeSegment(payloadB64);
  const now = Math.floor(Date.now() / 1e3);
  if (trimSlash2(String(claims.iss ?? "")) !== trimSlash2(options.issuer)) {
    throw new OidcError("ID token issuer mismatch");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.clientId)) throw new OidcError("ID token audience mismatch");
  if (audiences.length > 1 && claims.azp !== options.clientId) {
    throw new OidcError("ID token azp mismatch");
  }
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_LEEWAY_SECONDS < now) {
    throw new OidcError("ID token is expired");
  }
  if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_LEEWAY_SECONDS) {
    throw new OidcError("ID token iat is invalid");
  }
  if (!claims.nonce || !safeNonce(claims.nonce, options.nonce)) {
    throw new OidcError("ID token nonce mismatch");
  }
  if (typeof claims.sub !== "string" || claims.sub === "") throw new OidcError("ID token is missing sub");
  if (typeof claims.tenant_id !== "string" || claims.tenant_id === "") {
    throw new OidcError("ID token is missing tenant_id");
  }
  const atHash = claims.at_hash;
  if (typeof atHash === "string" && atHash !== "") {
    if (!options.accessToken) throw new OidcError("ID token has at_hash but no access token was provided");
    const digest = await sha256(new TextEncoder().encode(options.accessToken));
    const expected = base64UrlEncode(digest.slice(0, digest.length / 2));
    if (!safeNonce(expected, atHash)) throw new OidcError("ID token at_hash mismatch");
  }
  return claims;
}
function safeNonce(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function pkceChallenge(verifier) {
  const digest = await sha256(new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

// src/handler.ts
var DEFAULT_SCOPES = ["openid", "email"];
var DEFAULT_ABSOLUTE_TTL = 8 * 60 * 60;
var DEFAULT_IDLE_TTL = 30 * 60;
var DEFAULT_STATE_TTL = 10 * 60;
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
function normalizeConfig(config) {
  if (!isNonEmptyString(config.issuer)) throw new Error("ai-auth: issuer is required");
  if (!isNonEmptyString(config.clientId)) throw new Error("ai-auth: clientId is required");
  if (!isNonEmptyString(config.clientSecret)) throw new Error("ai-auth: clientSecret is required");
  if (!isNonEmptyString(config.redirectUri)) throw new Error("ai-auth: redirectUri is required");
  if (!isNonEmptyString(config.resource)) throw new Error("ai-auth: resource is required");
  if (!isNonEmptyString(config.sessionSecret) || config.sessionSecret.length < 32) {
    throw new Error("ai-auth: sessionSecret must be at least 32 characters");
  }
  const redirect2 = new URL(config.redirectUri);
  if (redirect2.protocol !== "https:" && !config.allowInsecureHttp) {
    throw new Error("ai-auth: redirectUri must use https");
  }
  const issuer = config.issuer.replace(/\/+$/u, "");
  const scopes = (config.scopes ?? DEFAULT_SCOPES).map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length === 0) throw new Error("ai-auth: scopes must not be empty");
  for (const required of ["openid", "email"]) {
    if (!scopes.includes(required)) throw new Error(`ai-auth: scope '${required}' is required`);
  }
  const cookiePrefix = config.cookiePrefix ?? "__Host-ai";
  const secureCookies = config.secureCookies ?? true;
  if (cookiePrefix.startsWith("__Host-") && !secureCookies) {
    throw new Error('ai-auth: __Host- cookies require secureCookies=true; use cookiePrefix "ai" for local http');
  }
  const allowedNextPrefixes = (config.allowedNextPrefixes ?? ["/ai"]).map(
    (prefix) => prefix.endsWith("/") ? prefix.slice(0, -1) || "/" : prefix
  );
  let identity = null;
  if (config.identity) {
    const api = config.identity.api.replace(/\/+$/u, "");
    if (!/^https:\/\//u.test(api) && !config.allowInsecureHttp) {
      throw new Error("ai-auth: identity.api must use https");
    }
    if (!isNonEmptyString(config.identity.tenantId)) {
      throw new Error("ai-auth: identity.tenantId is required");
    }
    const consentEndpoint = config.identity.consentCreate?.endpoint ?? "";
    const consentApiKey = config.identity.consentCreate?.apiKey ?? "";
    if (!/^https:\/\//u.test(consentEndpoint) && !config.allowInsecureHttp) {
      throw new Error("ai-auth: identity.consentCreate.endpoint must use https");
    }
    if (!isNonEmptyString(consentApiKey)) {
      throw new Error("ai-auth: identity.consentCreate.apiKey is required");
    }
    identity = {
      api,
      tenantId: config.identity.tenantId,
      consentCreateUrl: consentEndpoint,
      internalApiKey: consentApiKey,
      scopes: config.identity.scopes ?? DEFAULT_SCOPES
    };
  }
  return {
    raw: config,
    ...config.onError ? { onError: config.onError } : {},
    issuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    resource: config.resource,
    siteOrigin: redirect2.origin,
    scopes,
    sessionSecret: config.sessionSecret,
    absoluteTtl: config.sessionAbsoluteTtlSeconds ?? DEFAULT_ABSOLUTE_TTL,
    idleTtl: config.sessionIdleTtlSeconds ?? DEFAULT_IDLE_TTL,
    stateTtl: config.stateTtlSeconds ?? DEFAULT_STATE_TTL,
    cookiePrefix,
    secureCookies,
    allowedNextPrefixes,
    loginPath: "/ai/login",
    requireEmail: config.requireEmail ?? true,
    fetcher: config.fetch ?? fetch,
    identity
  };
}
function cookieOptions(config, maxAgeSeconds) {
  return {
    secure: config.secureCookies,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    ...maxAgeSeconds !== void 0 ? { maxAgeSeconds } : {}
  };
}
function stateCookieName(config, stateHash) {
  return `${config.cookiePrefix}-oauth-state-${stateHash}`;
}
function browserCookieName(config) {
  return `${config.cookiePrefix}-browser`;
}
function defaultNext(config) {
  const first = config.allowedNextPrefixes[0];
  if (!first || first === "/") return "/";
  return `${first}/`;
}
function sanitizeNext(config, raw) {
  const fallback = defaultNext(config);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/u.test(raw)) {
    return fallback;
  }
  let url;
  try {
    url = new URL(raw, config.siteOrigin);
  } catch {
    return fallback;
  }
  if (url.origin !== config.siteOrigin) return fallback;
  const pathname = url.pathname;
  const allowed = config.allowedNextPrefixes.some((prefix) => {
    if (prefix === "/") return true;
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
  if (!allowed) return fallback;
  return `${pathname}${url.search}${url.hash}`;
}
function loginErrorRedirect(config, code, headers) {
  const url = new URL(config.loginPath, config.siteOrigin);
  url.searchParams.set("error", code);
  return redirect(url.toString(), headers);
}
function redirect(location, headers) {
  const finalHeaders = headers ?? new Headers();
  finalHeaders.set("location", location);
  finalHeaders.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers: finalHeaders });
}
function jsonResponse(body, status = 200, headers) {
  const finalHeaders = headers ?? new Headers();
  finalHeaders.set("content-type", "application/json; charset=utf-8");
  finalHeaders.set("cache-control", "no-store");
  finalHeaders.set("x-content-type-options", "nosniff");
  finalHeaders.set("referrer-policy", "no-referrer");
  finalHeaders.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  return new Response(JSON.stringify(body), { status, headers: finalHeaders });
}
function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "GET, POST" }
  });
}
function reportError(config, error, context) {
  try {
    config.onError?.(error, context);
  } catch {
  }
}
async function exchangeCode(config, endpoints, code, verifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier
  });
  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  const response = await config.fetcher(endpoints.token, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: `Basic ${basic}`
    },
    body: body.toString()
  });
  if (!response.ok) throw new Error(`token endpoint returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`token endpoint error: ${payload.error}`);
  if (!isNonEmptyString(payload.access_token) || !isNonEmptyString(payload.id_token)) {
    throw new Error("token response is missing access_token/id_token");
  }
  if (String(payload.token_type ?? "").toLowerCase() !== "bearer") {
    throw new Error("token response token_type is not Bearer");
  }
  return payload;
}
async function fetchUserInfo(config, endpoints, accessToken) {
  const response = await config.fetcher(endpoints.userinfo, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
  });
  if (!response.ok) throw new Error(`userinfo returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!isNonEmptyString(payload.sub)) throw new Error("userinfo is missing sub");
  return payload;
}
function sessionCookieNameFor(config) {
  return sessionCookieName(config.cookiePrefix);
}
function readSessionCookie(config, request) {
  return readCookie(request, sessionCookieNameFor(config));
}
async function issueSessionCookie(config, headers, session) {
  const sealed = await sealSession(config.sessionSecret, session);
  appendSetCookie(headers, serializeCookie(sessionCookieNameFor(config), sealed, cookieOptions(config)));
}
function createAiAuth(configInput, hooks = {}) {
  const config = normalizeConfig({
    ...configInput,
    ...hooks.onError ? { onError: hooks.onError } : {}
  });
  const endpoints = createEndpointResolver({
    ...config.raw,
    issuer: config.issuer,
    fetch: config.fetcher,
    allowInsecureHttp: config.raw.allowInsecureHttp
  });
  const consent = createConsentChecker({ ...config.raw, fetch: config.fetcher });
  const embed = createEmbedHandlers({
    fetcher: config.fetcher,
    issuer: config.issuer,
    clientId: config.clientId,
    sessionSecret: config.sessionSecret,
    absoluteTtl: config.absoluteTtl,
    idleTtl: config.idleTtl,
    cookiePrefix: config.cookiePrefix,
    secureCookies: config.secureCookies,
    identity: config.identity,
    ...config.onError ? { onError: config.onError } : {}
  });
  let privateKey = null;
  async function login(request) {
    if (request.method !== "GET") return methodNotAllowed();
    try {
      const url = new URL(request.url);
      const next = sanitizeNext(config, url.searchParams.get("next"));
      const resolved = await endpoints();
      const state = base64UrlEncode(randomBytes(32));
      const nonce = base64UrlEncode(randomBytes(32));
      const verifier = base64UrlEncode(randomBytes(32));
      const browserNonce = base64UrlEncode(randomBytes(32));
      const challenge = await pkceChallenge(verifier);
      const stateHash = (await sha256Base64Url(state)).slice(0, 16);
      const payload = {
        v: 1,
        state,
        nonce,
        verifier,
        next,
        browserNonce,
        expiresAt: Math.floor(Date.now() / 1e3) + config.stateTtl
      };
      const stateCookie = await encryptJson(config.sessionSecret, payload);
      const headers = new Headers();
      appendSetCookie(headers, serializeCookie(stateCookieName(config, stateHash), stateCookie, cookieOptions(config, config.stateTtl)));
      appendSetCookie(headers, serializeCookie(browserCookieName(config), browserNonce, cookieOptions(config, config.stateTtl)));
      const authorize = new URL(resolved.authorize);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("client_id", config.clientId);
      authorize.searchParams.set("redirect_uri", config.redirectUri);
      authorize.searchParams.set("scope", config.scopes.join(" "));
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("nonce", nonce);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      return redirect(authorize.toString(), headers);
    } catch (error) {
      reportError(config, error, "login");
      return loginErrorRedirect(config, "login_unavailable");
    }
  }
  async function callback(request) {
    if (request.method !== "GET") return methodNotAllowed();
    const headers = new Headers();
    let stateHashForClear = "";
    const fail = (code) => {
      const clearHeaders = new Headers();
      if (stateHashForClear) {
        appendSetCookie(clearHeaders, clearCookie(stateCookieName(config, stateHashForClear), cookieOptions(config)));
      }
      appendSetCookie(clearHeaders, clearCookie(browserCookieName(config), cookieOptions(config)));
      return loginErrorRedirect(config, code, clearHeaders);
    };
    try {
      const url = new URL(request.url);
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        return fail(oauthError === "access_denied" ? "access_denied" : "login_failed");
      }
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (!state || !code) return fail("state_invalid");
      stateHashForClear = (await sha256Base64Url(state)).slice(0, 16);
      const sealedState = readCookie(request, stateCookieName(config, stateHashForClear));
      if (!sealedState) return fail("state_invalid");
      const payload = await decryptJson(config.sessionSecret, sealedState);
      if (!payload || payload.v !== 1 || !safeEqual(payload.state, state)) {
        return fail("state_invalid");
      }
      if (payload.expiresAt <= Math.floor(Date.now() / 1e3)) {
        return fail("state_expired");
      }
      const browserNonce = readCookie(request, browserCookieName(config)) ?? "";
      if (!safeEqual(payload.browserNonce, browserNonce)) {
        return fail("state_invalid");
      }
      const resolved = await endpoints();
      const tokens = await exchangeCode(config, resolved, code, payload.verifier);
      const claims = await verifyIdToken({
        token: tokens.id_token,
        issuer: config.issuer,
        clientId: config.clientId,
        nonce: payload.nonce,
        accessToken: tokens.access_token,
        jwksUri: resolved.jwks,
        fetcher: config.fetcher,
        allowInsecureHttp: config.raw.allowInsecureHttp === true
      });
      const userInfo = await fetchUserInfo(config, resolved, tokens.access_token);
      if (!safeEqual(userInfo.sub, claims.sub)) {
        throw new Error("userinfo sub does not match ID token sub");
      }
      if (config.requireEmail && !isNonEmptyString(userInfo.email)) {
        return fail("email_required");
      }
      const session2 = newSession({
        iss: config.issuer,
        sub: claims.sub,
        tenantId: claims.tenant_id,
        clientId: config.clientId,
        ...isNonEmptyString(userInfo.email) ? { email: userInfo.email } : {},
        ...typeof userInfo.email_verified === "boolean" ? { emailVerified: userInfo.email_verified } : {},
        ttl: { absoluteSeconds: config.absoluteTtl, idleSeconds: config.idleTtl }
      });
      if (consent && !await consent(session2)) {
        return fail("consent_revoked");
      }
      if (stateHashForClear) {
        appendSetCookie(headers, clearCookie(stateCookieName(config, stateHashForClear), cookieOptions(config)));
      }
      appendSetCookie(headers, clearCookie(browserCookieName(config), cookieOptions(config)));
      await issueSessionCookie(config, headers, session2);
      return redirect(new URL(payload.next || defaultNext(config), config.siteOrigin).toString(), headers);
    } catch (error) {
      reportError(config, error, "callback");
      return fail("login_failed");
    }
  }
  async function loadSession(request) {
    const headers = new Headers();
    const raw = readSessionCookie(config, request);
    if (!raw) return { response: jsonResponse({ authenticated: false }, 200, headers) };
    const opened = await openSession(config.sessionSecret, raw);
    if (!opened) return { response: jsonResponse({ authenticated: false }, 200, headers) };
    const touched = touchSession(opened, config.idleTtl);
    if (!touched) {
      appendSetCookie(headers, clearCookie(sessionCookieNameFor(config), cookieOptions(config)));
      return { response: jsonResponse({ authenticated: false }, 200, headers) };
    }
    if (consent && !await consent(touched)) {
      appendSetCookie(headers, clearCookie(sessionCookieNameFor(config), cookieOptions(config)));
      return { response: jsonResponse({ authenticated: false, error: "consent_revoked" }, 200, headers) };
    }
    await issueSessionCookie(config, headers, touched);
    return { session: touched, headers };
  }
  async function session(request) {
    if (request.method !== "GET") return methodNotAllowed();
    const result = await loadSession(request);
    if ("response" in result) return result.response;
    return jsonResponse(
      {
        authenticated: true,
        user: {
          sub: result.session.sub,
          email: result.session.email ?? null,
          emailVerified: result.session.emailVerified ?? false,
          tenantId: result.session.tenantId,
          issuer: result.session.iss
        }
      },
      200,
      result.headers
    );
  }
  async function logout(request) {
    if (request.method !== "POST") return methodNotAllowed();
    const headers = new Headers();
    appendSetCookie(headers, clearCookie(sessionCookieNameFor(config), cookieOptions(config)));
    return jsonResponse({ ok: true }, 200, headers);
  }
  async function getUser(request) {
    const raw = readSessionCookie(config, request);
    if (!raw) return null;
    const opened = await openSession(config.sessionSecret, raw);
    if (!opened) return null;
    const touched = touchSession(opened, config.idleTtl);
    if (!touched) return null;
    if (consent && !await consent(touched)) return null;
    return touched;
  }
  async function mintInternalToken(sessionValue) {
    const settings = config.raw.internalJwt;
    if (!settings) return null;
    privateKey ??= importRs256PrivateKey(settings.privateKeyPkcs8);
    const now = Math.floor(Date.now() / 1e3);
    const ttl = Math.min(Math.max(settings.ttlSeconds ?? 60, 1), 60);
    const header = { alg: "RS256", typ: "JWT", kid: settings.kid };
    const payload = {
      iss: settings.issuer,
      sub: `${sessionValue.iss}:${sessionValue.sub}`,
      aud: settings.audience,
      tenant_id: sessionValue.tenantId,
      client_id: sessionValue.clientId,
      iat: now,
      exp: now + ttl,
      jti: base64UrlEncode(randomBytes(16))
    };
    const signingInput = `${base64UrlEncode(utf8(JSON.stringify(header)))}.${base64UrlEncode(utf8(JSON.stringify(payload)))}`;
    const signature = await signRs256(await privateKey, utf8(signingInput));
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }
  async function route(request) {
    let pathname;
    try {
      pathname = new URL(request.url).pathname.replace(/\/+$/u, "");
    } catch {
      return jsonResponse({ error: "bad_request" }, 400);
    }
    if (pathname.endsWith("/embed/email/send")) return embed.sendEmail(request);
    if (pathname.endsWith("/embed/email/login")) return embed.loginEmail(request);
    if (pathname.endsWith("/embed/qr/initiate")) return embed.qrInitiate(request);
    if (pathname.endsWith("/embed/qr/status")) return embed.qrStatus(request);
    if (pathname.endsWith("/embed/qr/revoke")) return embed.qrRevoke(request);
    if (pathname.endsWith("/login")) return login(request);
    if (pathname.endsWith("/callback")) return callback(request);
    if (pathname.endsWith("/session")) return session(request);
    if (pathname.endsWith("/logout")) return logout(request);
    return jsonResponse({ error: "not_found" }, 404);
  }
  return { route, embed, login, callback, session, logout, getUser, mintInternalToken };
}

// src/adapters.ts
function createCloudflareHandler(auth) {
  return { fetch: (request) => auth.route(request) };
}
function createVercelEdgeHandler(auth) {
  return (request) => auth.route(request);
}
function headerValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value;
}
function requestUrl(request) {
  const host = headerValue(request.headers["x-forwarded-host"]) ?? headerValue(request.headers.host) ?? "localhost";
  const proto = headerValue(request.headers["x-forwarded-proto"]) ?? "https";
  const path = request.url ?? "/";
  return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}
async function readBody(request) {
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return void 0;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return void 0;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
function createNodeHandler(auth) {
  return async (req, res) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === void 0 || key.toLowerCase() === "set-cookie") continue;
      const joined = headerValue(value);
      if (joined !== void 0) headers.set(key, joined);
    }
    const body = await readBody(req);
    const request = new Request(requestUrl(req), {
      method: req.method ?? "GET",
      headers,
      ...body ? { body } : {}
    });
    const response = await auth.route(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      res.setHeader(key, value);
    });
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);
    const arrayBuffer = await response.arrayBuffer();
    res.end(new Uint8Array(arrayBuffer));
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  clearConsentCache,
  clearOidcCache,
  createAiAuth,
  createCloudflareHandler,
  createNodeHandler,
  createVercelEdgeHandler
});
