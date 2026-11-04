import { Autional } from "@autional/core";

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

const issuer = "https://api.autional.cn";
const apiUrl = "https://api.autional.cn/bff";
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const tenantId = process.env.TENANT_ID;

const autional = new Autional({ appId: "pending", issuer, apiUrl, platform, tenantId });
const res = await autional.login({ email: adminEmail, password: adminPassword, tenantId });
const token = res.accessToken;

const base = "https://api.autional.cn";
const candidates = [
  "/oauth/api/v1/admin/clients",
  "/oauth/api/v1/admin/oauth-clients",
  "/oauth/api/v1/admin/applications",
  "/bff/oauth/api/v1/admin/clients",
  "/bff/oauth/api/v1/admin/oauth-clients",
  "/bff/oauth/admin/clients",
  "/identity/api/v1/admin/oauth-clients",
  "/identity/api/v1/admin/clients",
  `/identity/api/v1/admin/tenants/${tenantId}/oauth-clients`,
  "/bff/identity/api/v1/admin/tenants",
];

for (const path of candidates) {
  try {
    const r = await fetch(base + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await r.text();
    console.log(r.status, path, "|", text.slice(0, 260).replace(/\s+/g, " "));
  } catch (e) {
    console.log("ERR", path, e.message);
  }
}
process.exit(0);
