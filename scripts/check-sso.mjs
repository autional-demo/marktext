/**
 * SSO 预检（Skill 5.2b 第 4/5 步）。
 * 用法：
 *   APP_ID=client-xxx CALLBACK=https://app.example.com/oauth/callback ORIGIN=https://app.example.com node scripts/check-sso.mjs
 * 期望：authorize 返回 302 且回指回调（带 error=login_required）；CORS 预检 204 且 ACAO = ORIGIN。
 */
import crypto from "node:crypto";

const APP_ID = process.env.APP_ID;
const CALLBACK = process.env.CALLBACK;
const ORIGIN = process.env.ORIGIN;

if (!APP_ID || !CALLBACK || !ORIGIN) {
  console.error("缺少 APP_ID / CALLBACK / ORIGIN");
  process.exit(2);
}

const verifier = crypto.randomBytes(48).toString("base64url").slice(0, 64);
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

const authorize = new URL("https://api.autional.cn/oauth/api/v1/oauth/authorize");
authorize.searchParams.set("response_type", "code");
authorize.searchParams.set("client_id", APP_ID);
authorize.searchParams.set("redirect_uri", CALLBACK);
authorize.searchParams.set("scope", "openid profile email");
authorize.searchParams.set("state", "preflight");
authorize.searchParams.set("code_challenge", challenge);
authorize.searchParams.set("code_challenge_method", "S256");

const step1 = await fetch(authorize, { redirect: "manual", headers: { Accept: "application/json" } });
const location = step1.headers.get("location") ?? "";
const ok1 =
  step1.status === 302 &&
  location.startsWith(CALLBACK) &&
  /error=login_required/.test(location);

console.log(
  ok1 ? "PASS" : "FAIL",
  "authorize",
  "|",
  `status=${step1.status}`,
  `location=${location.slice(0, 160) || "(none)"}`,
);

const step2 = await fetch("https://api.autional.cn/oauth/api/v1/oauth/token", {
  method: "OPTIONS",
  headers: {
    Origin: ORIGIN,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
  },
});
const acao = step2.headers.get("access-control-allow-origin");
const ok2 = step2.status === 204 && acao === ORIGIN;
console.log(ok2 ? "PASS" : "FAIL", "cors", "|", `status=${step2.status} acao=${acao ?? "(none)"}`);

try {
  const info = await fetch(`https://api.autional.cn/oauth/api/v1/oauth/client/${encodeURIComponent(APP_ID)}`, {
    headers: { Accept: "application/json" },
  });
  const body = await info.text();
  console.log("INFO", "client", "|", `status=${info.status}`, body.slice(0, 240));
} catch (err) {
  console.log("INFO", "client", "|", err.message);
}

process.exit(ok1 && ok2 ? 0 : 1);
