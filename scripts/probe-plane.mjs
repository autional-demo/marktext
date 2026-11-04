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

const tenantId = process.env.TENANT_ID;
const autional = new Autional({
  appId: "pending",
  issuer: "https://api.autional.cn",
  apiUrl: "https://api.autional.cn/bff",
  platform,
  tenantId,
});
const { accessToken } = await autional.login({
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
  tenantId,
});

const urls = [
  ["https://api.autional.cn/bff/identity/api/v1/admin/users?page=1&page_size=1"],
  ["https://api.autional.cn/bff/oauth/api/v1/admin/oauth/clients?page=1&page_size=1"],
];
for (const [u] of urls) {
  const r = await fetch(u, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "X-Entry-Plane": "admin",
      "X-Tenant-ID": tenantId,
      "X-Namespace": "prod",
    },
  });
  const text = await r.text();
  console.log(r.status, u.replace("https://api.autional.cn", ""), "|", text.slice(0, 300).replace(/\s+/g, " "));
}
process.exit(0);
