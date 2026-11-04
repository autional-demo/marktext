/**
 * 创建 Autional 试用租户（Phase 3），并做 3.1a 注册后自检。
 * 用法：ADMIN_EMAIL=x ADMIN_PASSWORD=y node scripts/create-tenant.mjs <tenant-name>
 * 不打印任何 token；密码来自环境变量，不落盘。
 */
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

const name = process.argv[2] ?? "marktext-web";
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error("缺少 ADMIN_EMAIL / ADMIN_PASSWORD");
  process.exit(2);
}

const autional = new Autional({
  appId: "pending",
  issuer: process.env.AUTIONAL_ISSUER ?? "https://api.autional.cn",
  apiUrl: process.env.AUTIONAL_API_URL ?? "https://api.autional.cn/bff",
  platform,
});

try {
  const tenant = await autional.createTrialTenant({
    name,
    adminEmail,
    adminPassword,
    agreementAccepted: true,
  });
  console.log("CREATE_OK", JSON.stringify(tenant));

  const login = await autional.login({
    email: adminEmail,
    password: adminPassword,
    tenantId: tenant.tenantId,
  });
  console.log(
    "LOGIN_OK",
    JSON.stringify({
      userId: login.user?.id,
      email: login.user?.email,
      tokenType: login.tokenType,
      expiresIn: login.expiresIn,
      accessTokenLength: login.accessToken?.length ?? 0,
    }),
  );
} catch (err) {
  console.error("FAILED", err?.name, err?.status ?? "", err?.code ?? "", err?.message);
  if (err?.body) console.error("BODY", JSON.stringify(err.body).slice(0, 800));
  process.exit(1);
}
