#!/usr/bin/env node
/**
 * add-oauth-redirect.mjs — 给已有的公开客户端补一个回调 / CORS 源。
 *
 * 背景：SSO 回调是运行时取 window.location.origin，所以新域名（marktext.denglu.dev）
 * 必须在应用客户端的 redirect_uri 与 CORS 源里登记，否则 authorize 直接 400。
 *
 * 用法（密码走环境变量，不进命令历史、不进对话）：
 *   $env:ADMIN_EMAIL='admin@example.com'
 *   $env:ADMIN_PASSWORD='******'
 *   node scripts/add-oauth-redirect.mjs            # 先只读：打印客户端现状
 *   $env:APPLY='1'; node scripts/add-oauth-redirect.mjs   # 合并写入
 *
 * 可覆盖的环境变量：TENANT_ID、CLIENT_ID、NEW_ORIGIN、ADMIN_EMAIL、ADMIN_PASSWORD、APPLY。
 */
import { Autional } from "@autional/core";

const API = "https://api.autional.cn";
const TENANT_ID =
  process.env.TENANT_ID || process.env.NEXT_PUBLIC_AUTIONAL_TENANT_ID || "";
const CLIENT_ID = process.env.CLIENT_ID || "client-Ost6T4zMRKoh";
const NEW_ORIGIN = (process.env.NEW_ORIGIN || "https://marktext.denglu.dev").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const APPLY = process.env.APPLY === "1";

if (!TENANT_ID || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("缺少 TENANT_ID / ADMIN_EMAIL / ADMIN_PASSWORD");
  process.exit(2);
}

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

const autional = new Autional({
  appId: "pending",
  issuer: API,
  apiUrl: `${API}/bff`,
  platform,
  tenantId: TENANT_ID,
});

const adminHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Entry-Plane": "admin",
  "X-Tenant-ID": TENANT_ID,
  "X-Namespace": "prod",
});

const call = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: adminHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json, text };
};

const login = async () => {
  const { accessToken } = await autional.login({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    tenantId: TENANT_ID,
  });
  return accessToken;
};

// 1) 先登录（普通平面）
let token = await login();

// 2) 必要时激活 admin 角色 1 小时（试用租户成员默认是 member）
const ensureAdmin = async () => {
  const probe = await call(token, "GET", `/oauth/api/v1/admin/oauth/clients?page=1&page_size=1`);
  if (probe.status === 200) return true;
  console.log("admin 平面不可用：", probe.status, (probe.text || "").slice(0, 200));

  const roles = await call(token, "GET", "/identity/api/v1/auth/me/role-activations/available-roles");
  const list = roles.json?.data ?? roles.json?.roles ?? roles.json ?? [];
  const admin = (Array.isArray(list) ? list : []).find((r) => /admin/i.test(r.code ?? r.name ?? ""));
  if (!admin?.id) {
    console.log("找不到可激活的 admin 角色：", JSON.stringify(roles.json).slice(0, 300));
    return false;
  }
  const act = await call(token, "POST", "/identity/api/v1/auth/me/role-activations", {
    role_id: admin.id,
    duration: "1h",
    justification: "登记 marktext.denglu.dev 的 OAuth 回调",
  });
  console.log("角色激活：", act.status, (act.text || "").slice(0, 200));
  token = await login();
  return true;
};

if (!(await ensureAdmin())) process.exit(1);

// 3) 读客户端
const list = await call(token, "GET", `/oauth/api/v1/admin/oauth/clients?page=1&page_size=50`);
if (list.status !== 200) {
  console.log("列表失败：", list.status, (list.text || "").slice(0, 300));
  process.exit(1);
}
const items = list.json?.data?.items ?? list.json?.items ?? list.json?.data ?? list.json ?? [];
const client = (Array.isArray(items) ? items : []).find((c) => c.clientId === CLIENT_ID);
if (!client) {
  console.log(`找不到 ${CLIENT_ID}；现有：`, (items || []).map((c) => c.clientId).join(", "));
  process.exit(1);
}

const asArray = (v) => (Array.isArray(v) ? v.slice() : []);
const before = {
  redirectUris: asArray(client.redirectUris),
  corsOrigins: asArray(client.corsOrigins),
  postLogoutRedirectUris: asArray(client.postLogoutRedirectUris),
};

console.log("客户端：", client.clientId, client.name, "id=", client.id);
console.log("现有回调：", before.redirectUris);
console.log("现有 CORS：", before.corsOrigins);

const add = (arr, value) => (arr.includes(value) ? arr : [...arr, value]);
const after = {
  redirectUris: add(before.redirectUris, `${NEW_ORIGIN}/oauth/callback`),
  corsOrigins: add(before.corsOrigins, NEW_ORIGIN),
  postLogoutRedirectUris: add(before.postLogoutRedirectUris, `${NEW_ORIGIN}/`),
};

const changed =
  after.redirectUris.length !== before.redirectUris.length ||
  after.corsOrigins.length !== before.corsOrigins.length ||
  after.postLogoutRedirectUris.length !== before.postLogoutRedirectUris.length;

if (!changed) {
  console.log("已经包含目标回调，无需改动。");
  process.exit(0);
}
console.log("待写入：", after);
if (!APPLY) {
  console.log("只读模式。确认后设 $env:APPLY='1' 重跑。");
  process.exit(0);
}

// 4) 写入：优先 PUT 全量，再退回 PATCH
const payload = {
  name: client.name,
  website: client.website,
  redirectUris: after.redirectUris,
  corsOrigins: after.corsOrigins,
  postLogoutRedirectUris: after.postLogoutRedirectUris,
  grantTypes: client.grantTypes,
  scopes: client.scopes,
  isConfidential: client.isConfidential,
  clientAuthMethods: client.clientAuthMethods,
};

const base = `/oauth/api/v1/admin/oauth/clients/${client.id ?? client.clientId}`;
for (const method of ["PUT", "PATCH"]) {
  const res = await call(token, method, base, payload);
  console.log(`${method} ${base} ->`, res.status, (res.text || "").slice(0, 300));
  if (res.status >= 200 && res.status < 300) {
    const check = await call(token, "GET", `/oauth/api/v1/admin/oauth/clients?page=1&page_size=50`);
    const got = (check.json?.data?.items ?? check.json?.items ?? check.json?.data ?? []).find(
      (c) => c.clientId === CLIENT_ID,
    );
    console.log("写入后回调：", got?.redirectUris);
    console.log("写入后 CORS：", got?.corsOrigins);
    process.exit(0);
  }
}
console.log("写入失败：两个方法都没成功。");
process.exit(1);
