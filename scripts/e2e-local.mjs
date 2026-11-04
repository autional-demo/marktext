#!/usr/bin/env node
/**
 * 本地端到端验证（不接触真实 Autional 账号）。
 *
 * 做法：起一个本地身份服务替身（/identity/api/v1/auth/me），
 * 启动 next start 并把 AUTIONAL_ME_URL 指过去，跑完
 * 创建/列表/读取/保存/冲突/删除 全流程后清理数据。
 *
 * 用法：node --env-file=.env.local scripts/e2e-local.mjs
 *
 * 注意：只能验证本地服务。生产环境走真实身份服务，伪造 token 无效。
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { neon } from "@neondatabase/serverless";

const PORT = 3100;
const IDP_PORT = 4010;
const USER_ID = "e2e-user-0001";
const TENANT_ID = "e2e-tenant-0001";
const BASE = `http://127.0.0.1:${PORT}`;
const ME_PATH = "/identity/api/v1/auth/me";
const ME_URL = `http://127.0.0.1:${IDP_PORT}${ME_PATH}`;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未设置，用 --env-file=.env.local 运行");
  process.exit(1);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

/* 1. 本地身份服务替身 */
const secret = randomBytes(32);
let expectedToken = "";

const idpServer = http.createServer((req, res) => {
  if (req.url === ME_PATH && req.headers.authorization === `Bearer ${expectedToken}`) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { id: USER_ID } }));
    return;
  }
  if (req.url === ME_PATH) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => idpServer.listen(IDP_PORT, "127.0.0.1", resolve));
console.log(`IDP   http://127.0.0.1:${IDP_PORT}${ME_PATH}`);

/* 2. 启动 next start */
const next = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
  {
    env: { ...process.env, AUTIONAL_ME_URL: ME_URL },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let nextErr = "";
next.stderr.on("data", (chunk) => {
  nextErr += chunk.toString();
});

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function shutdown() {
  try {
    next.kill();
  } catch {
    /* ignore */
  }
  try {
    idpServer.close();
  } catch {
    /* ignore */
  }
}

let exitCode = 0;
try {
  if (!(await waitForServer())) {
    console.error("next start 未就绪\n" + nextErr);
    throw new Error("server not ready");
  }
  console.log(`next  ${BASE}`);

  expectedToken = await new SignJWT({ tenant_id: TENANT_ID })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  const api = (path, init = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${expectedToken}`,
        ...(init.headers ?? {}),
      },
    });

  /* 3. 无 token 应 401 */
  const noAuth = await fetch(`${BASE}/api/docs`);
  check("无 token 返回 401", noAuth.status === 401, `status=${noAuth.status}`);

  /* 4. 创建 */
  const docId = `e2e-${Date.now()}`;
  const createRes = await api("/api/docs", {
    method: "POST",
    body: JSON.stringify({ id: docId, title: "E2E 标题", content: "# 第一版" }),
  });
  const created = await createRes.json();
  check("创建文档 201", createRes.status === 201, `status=${createRes.status}`);
  check("创建返回 rev=1", created?.doc?.rev === 1, `rev=${created?.doc?.rev}`);

  /* 5. 列表 */
  const listRes = await api("/api/docs");
  const list = await listRes.json();
  const listed = list.docs?.find((d) => d.id === docId);
  check("列表包含新文档", !!listed);
  check("列表标题已解密", listed?.title === "E2E 标题", `title=${listed?.title}`);

  /* 6. 读取 */
  const getRes = await api(`/api/docs/${docId}`);
  const got = await getRes.json();
  check("读取正文一致", got?.doc?.content === "# 第一版");

  /* 7. 保存 */
  const putRes = await api(`/api/docs/${docId}`, {
    method: "PUT",
    body: JSON.stringify({ title: "E2E 标题", content: "# 第二版", rev: 1 }),
  });
  const put = await putRes.json();
  check("保存成功 rev=2", putRes.status === 200 && put?.doc?.rev === 2, `rev=${put?.doc?.rev}`);

  /* 8. 旧 rev 冲突 */
  const conflictRes = await api(`/api/docs/${docId}`, {
    method: "PUT",
    body: JSON.stringify({ title: "冲突", content: "x", rev: 1 }),
  });
  const conflict = await conflictRes.json();
  check("旧 rev 返回 409", conflictRes.status === 409, `status=${conflictRes.status}`);
  check("409 带回云端版本", conflict?.doc?.rev === 2, `rev=${conflict?.doc?.rev}`);

  /* 9. 库里是密文 */
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    select title, content from documents where id = ${docId} and user_id = ${USER_ID}
  `;
  const raw = rows[0];
  check("库里正文为密文", !!raw && raw.content.startsWith("v1:"), raw?.content?.slice(0, 8));
  check("库里不含明文", !!raw && !raw.content.includes("第二版"));

  /* 10. 删除 */
  const delRes = await api(`/api/docs/${docId}`, { method: "DELETE" });
  check("删除成功", delRes.status === 200, `status=${delRes.status}`);

  const afterDel = await api(`/api/docs/${docId}`);
  check("删除后读取 404", afterDel.status === 404, `status=${afterDel.status}`);

  /* 11. 清理 */
  await sql`delete from documents where user_id = ${USER_ID}`;
} catch (err) {
  console.error("E2E 异常:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  shutdown();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) exitCode = 1;
process.exit(exitCode);
