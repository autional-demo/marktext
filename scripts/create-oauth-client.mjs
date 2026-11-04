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
const tenantId = process.env.TENANT_ID;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

const PROD = "https://marktext-web.vercel.app";
const LOCAL = "http://localhost:3000";

const autional = new Autional({ appId: "pending", issuer, apiUrl, platform, tenantId });
const { accessToken } = await autional.login({
  email: adminEmail,
  password: adminPassword,
  tenantId,
});

const body = {
  name: "MarkText Web",
  website: PROD,
  redirectUris: [`${PROD}/oauth/callback`, `${LOCAL}/oauth/callback`],
  postLogoutRedirectUris: [`${PROD}/`, `${LOCAL}/`],
  corsOrigins: [PROD, LOCAL],
  grantTypes: ["authorization_code", "refresh_token"],
  scopes: ["openid", "profile", "email"],
  isConfidential: false,
  clientAuthMethods: ["none"],
};

void accessToken;
try {
  const json = await autional.api.post("/oauth/api/v1/admin/oauth/clients", body);
  console.log(
    "CLIENT",
    JSON.stringify({
      clientId: json.clientId,
      id: json.id,
      name: json.name,
      isConfidential: json.isConfidential,
      grantTypes: json.grantTypes,
      corsOrigins: json.corsOrigins,
      redirectUris: json.redirectUris,
      postLogoutRedirectUris: json.postLogoutRedirectUris,
      status: json.status,
    }),
  );
} catch (err) {
  console.log("ERR", err?.status ?? "", err?.message, JSON.stringify(err?.body ?? {}).slice(0, 1000));
}
process.exit(0);
