/**
 * Phase 7 集成测试：discovery / register / login / profile / refresh / logout。
 * 用法：node scripts/integration-test.mjs
 */
import { Autional, processPasswordForTransmission } from "@autional/core";

const store = new Map();
const platform = {
  storage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    keys: () => Array.from(store.keys()),
  },
  http: { request: (input, init) => fetch(input, init) },
};

const tenantId = process.env.TENANT_ID;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

const autional = new Autional({
  appId: "pending",
  issuer: "https://api.autional.cn",
  apiUrl: "https://api.autional.cn/bff",
  platform,
  tenantId,
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(ok ? "PASS" : "FAIL", name, "|", detail);
};

// 1. Discovery
const disco = await fetch("https://api.autional.cn/.well-known/openid-configuration");
const discoJson = await disco.json();
check(
  "discovery",
  disco.status === 200 && discoJson.issuer === "https://api.autional.cn",
  `status=${disco.status} issuer=${discoJson.issuer}`,
);

// 2. Register（SDK 0.4.1 register 字段有缺陷，按服务端契约直接调用）
let registered = false;
try {
  const cfg = await autional.fetchAuthConfig(tenantId);
  const policy = cfg.passwordPolicy ?? {};
  const processed = await processPasswordForTransmission(password, {
    mode: policy.mode ?? "plain",
    tenantId: policy.tenantId ?? tenantId,
    requireUpper: false,
    minLength: 0,
    publicKey: policy.publicKey ?? "",
  });
  const r = await fetch("https://api.autional.cn/bff/identity/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      email,
      password: processed.password,
      password_transmission: processed.passwordTransmission,
      tenant_id: tenantId,
    }),
  });
  const t = await r.json().catch(() => ({}));
  registered = r.status === 201 || r.status === 409;
  check(
    "register",
    registered,
    `status=${r.status} ${t?.data?.user_id ?? t?.detail ?? ""}`,
  );
} catch (err) {
  check("register", false, `${err?.status ?? ""} ${err?.code ?? ""} ${err?.message ?? ""}`);
}

// 3. Login
let loginResult = null;
try {
  loginResult = await autional.login({ email, password, tenantId });
  check("login", !!loginResult.accessToken, `expiresIn=${loginResult.expiresIn}`);
} catch (err) {
  check("login", false, `${err?.status ?? ""} ${err?.code ?? ""} ${err?.message ?? ""}`);
}

// 4. Profile
try {
  const p = await autional.getProfile();
  check("profile", p?.email === email || p?.id === loginResult?.user?.id, `email=${p?.email}`);
} catch (err) {
  check("profile", false, `${err?.status ?? ""} ${err?.message ?? ""}`);
}

// 5. 令牌可用性（SDK 在 401 时自动刷新；0.4.1 未暴露 refreshToken）
try {
  const token = await autional.getAccessToken();
  const r = await fetch("https://api.autional.cn/bff/identity/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  check("access-token", !!token && r.status === 200, `status=${r.status} tokenLen=${token?.length ?? 0}`);
} catch (err) {
  check("access-token", false, `${err?.status ?? ""} ${err?.message ?? ""}`);
}

// 6. Revoked check: capture token, logout, then call profile with old token
const oldToken = await autional.getAccessToken();
try {
  await autional.logout();
  check("logout", true, "logout resolved");
} catch (err) {
  check("logout", false, `${err?.status ?? ""} ${err?.message ?? ""}`);
}

try {
  const r = await fetch("https://api.autional.cn/bff/identity/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${oldToken}`, Accept: "application/json" },
  });
  check("revoked", r.status === 401 || r.status === 403, `old token status=${r.status}`);
} catch (err) {
  check("revoked", false, err.message);
}

// 8. Auth config
try {
  const cfg = await autional.fetchAuthConfig(tenantId);
  check("auth-config", !!cfg && (cfg.tenantId || cfg.tenant_id), `loginMethods=${JSON.stringify(cfg.loginMethods ?? cfg.login_methods)}`);
} catch (err) {
  check("auth-config", false, `${err?.status ?? ""} ${err?.message ?? ""}`);
}

const failed = results.filter((r) => !r.ok);
console.log("\nSUMMARY", `${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
