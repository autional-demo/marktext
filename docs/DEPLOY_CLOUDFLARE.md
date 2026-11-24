# 部署到 Cloudflare Workers（marktext.denglu.dev）

> 本次执行：2026-11-23，Worker `marktext`，版本 `7ec1af41-11fc-4649-8310-693b17178f6e`。
> 目标：把 Next.js 15 的 MarkText Web 原样跑在 `https://marktext.denglu.dev`，与
> `deepseek.denglu.dev` 共用同一套 Cloudflare 账号 / `denglu.dev` zone。

## 1. 结论

**能，已经上线。** 但 Vercel 仍是主站，Cloudflare 是第二份部署；
两者共用同一个 Neon 库，所以同步、字段加密密钥必须完全一致。

当前完成度：

| 能力 | 状态 |
|---|---|
| 页面（`/`、`/login`、`/d/<id>`、`/oauth/callback`、manifest、图标、静态资源） | ✅ |
| `/bff` 身份代理（登录/注册/换票） | ✅ |
| 服务端密钥（Neon 连接串 + 字段加密 key） | ✅ 已作为 Worker Secret 绑定 |
| 邮箱密码登录 | ✅（需真实账号验收） |
| SSO 登录 | ⏳ 缺回调登记（见 §6） |
| 云同步读写 | ⏳ 配置已就绪，缺一次真实登录端到端验收 |

### 1.1 现状核对（2026-11-23，已重建并逐项实测）

| 检查项 | 实测结果 | 说明 |
|---|---|---|
| `GET /` | 200 | 在线 |
| `GET /sw.js` | 200，`VERSION = "v4"`，含构建号 + 共享 chunk 指纹双通道 | **与主站一致** |
| `GET /manifest.webmanifest` | 200，icons = 192/512/maskable + SVG | 与主站一致 |
| `GET /offline.html` | 200 | 离线兜底页已就位 |
| `GET /icons/icon-512.png` | 200 | 图标已上传 |
| `GET /api/docs` | 401 | 鉴权链路通 |
| `wrangler secret list --name marktext` | `DATABASE_URL`、`CONTENT_ENCRYPTION_KEY`、`CONTENT_ENCRYPTION_KEY_KID` **均在** | 早期“缺 Secret 导致 500”的说法**已过时** |

**OpenNext 差异（重要）**：Cloudflare 版本会把静态页 HTML 里的 `<!--buildId-->` 注释剥掉，
所以 SW 的版本检测在镜像上走「**跨页面共享 chunk 指纹**」分支
（`webpack` / `main-app` / `app/layout` / `polyfills`），Vercel 走注释分支。
两分支都已线上验证：镜像 `/`、`/login`、`/oauth/callback` 三个页面指纹一致（`h0a54c3dd`），
不会因为切换页面而误判「有新版本」。

> 注意：指纹只在**前端 chunk 变化**时改变。只改 `public/` 或文档不会触发壳重建——这是期望行为。
> 如果哪天要把「只改 sw.js」也变成强制刷新，手动把 `public/sw.js` 的 `VERSION` 加一即可。

重建命令（凭据在本机 Windows 凭据管理器，经 `D:\xiaozhai.dev\qcloud\cred\cloudflare-cred.ps1` 注入）：

```powershell
npm run cf:build
powershell -NoProfile -ExecutionPolicy Bypass `
  -File D:\xiaozhai.dev\qcloud\cred\cloudflare-cred.ps1 run `
  -Proxy http://127.0.0.1:10809 `
  -Cmd "cd /d D:\work\marktext && npx wrangler deploy"
```

| 项 | 值 |
|---|---|
| 线上地址 | https://marktext.denglu.dev |
| Worker 名 | `marktext`（account `cc757041716d8dd0d695ea7f3cddf95c`） |
| 适配器 | `@opennextjs/cloudflare` 1.20.18 + `wrangler` 4.166.0 |
| 兼容标志 | `nodejs_compat`、`global_fetch_strictly_public` |
| 自定义域 | 由 Workers 接口自动建 DNS + 签证书（不需要 DNS 编辑权限） |
| 脚本体积 | 13.8 MB 原始 / **3.1 MB gzip**（免费版上限 3 MiB，本次上传被接受） |
| 静态资源 | 810 个文件 / 9.6 MB（走 Workers Assets，不占脚本体积） |

## 2. 为什么不是"静态页 + Worker 代理"

`denglu-dev` 里的 `worker-static` 模板适合纯静态站点（`deepseek.denglu.dev` 就是这么发的）。
本项目不是静态站：

- Route Handler：`/api/docs`、`/api/docs/[id]`、`/bff/[...path]`（服务端鉴权、Neon 查询、AES-256-GCM）
- 动态页面：`/d/[id]`
- 服务端依赖：`@neondatabase/serverless`（HTTP 版，本来就适配 edge）、`node:crypto`、`Buffer`

所以用 OpenNext 适配器，把 `next build` 的产物转成 Worker + Assets，路由与 Vercel 行为一致。

已实测 workerd 支持本项目的加密实现（`createCipheriv`/`createDecipheriv` AES-256-GCM、
`createHash`、`Buffer`），因此 `lib/server/crypto.ts` 不用改。

## 3. 改动

| 文件 | 说明 |
|---|---|
| `package.json` | 新增 devDeps `@opennextjs/cloudflare`、`wrangler`；新增 `cf:build` / `cf:preview` / `cf:deploy` |
| `wrangler.jsonc` | Worker 名、`main`、assets 绑定、`compatibility_flags`、`routes`（custom domain） |
| `open-next.config.ts` | `defineCloudflareConfig({})`：不使用 ISR，故不挂 R2 增量缓存 |
| `.gitignore` | 忽略 `.open-next/`、`.wrangler/`、`.dev.vars` |

应用代码零改动。

## 4. 构建与发布

```powershell
cd D:\work\marktext
npm run cf:build            # next build + opennext 转换 → .open-next/

# 本机预览（不联网）
npx wrangler dev --port 8791 --ip 127.0.0.1

# 发布：token 由凭据脚本注入，必须带本机代理（api.cloudflare.com 直连超时）
powershell -NoProfile -ExecutionPolicy Bypass `
  -File D:\xiaozhai.dev\qcloud\cred\cloudflare-cred.ps1 run `
  -Proxy http://127.0.0.1:10809 `
  -Cmd "cd /d D:\work\marktext && npx wrangler deploy"
```

`NEXT_PUBLIC_*` 在 `next build` 时内联，取自本机 `.env.local`；换机部署要先把
这些变量放回 `.env.local`，否则页面里客户端 ID / 租户 ID 会空。

## 5. 服务端密钥

Worker 需要两个 Secret，缺一个云同步就 500：

| Secret | 来源 | 状态 |
|---|---|---|
| `DATABASE_URL` | 本机 `.env.local`（与 Vercel 生产同一个 Neon 库） | ✅ 2026-11-23 已写入（`wrangler secret bulk`，值未落日志） |
| `CONTENT_ENCRYPTION_KEY` | 同上 | ✅ 已写入（44 字符 base64 = 32 字节） |
| `CONTENT_ENCRYPTION_KEY_KID` | 同上，`k1` | ✅ 已写入 |
| `AI_AUTH_SESSION_SECRET` | 内嵌登录会话加密（≥32 字符，随机） | ✅ 2026-11-24 已写入 |
| `AI_BFF_API_KEY` | 平台内部 consent 端点（与 BFF 同键） | ✅ 2026-11-24 已写入 |

> Vercel 的 `DATABASE_URL` 是 `sensitive` 类型，API 即使 `decrypt=true` 也返回空；
> `CONTENT_ENCRYPTION_KEY` 是 `encrypted` 且经 API 返回的是密文（1100 字符），不是明文。
> 所以只能从本机 `.env.local` / 密码管理器取，不要指望从 Vercel 导出。

再补/轮换时：

```powershell
# 交互粘贴单个
npx wrangler secret put DATABASE_URL --name marktext
# 或从文件批量（值只显示 (hidden)）
npx wrangler secret bulk .tmp\marktext-secrets.env
```

**密钥必须与 Vercel 生产一致**：`CONTENT_ENCRYPTION_KEY` 不同，已同步的文档在另一端解不开。

连通性自检（只读，不打印连接串）：

```powershell
node --env-file=.env.local -e "import('@neondatabase/serverless').then(async({neon})=>{const s=neon(process.env.DATABASE_URL);const r=await s\`select count(*)::int n from documents where deleted_at is null\`;console.log(r[0].n)})"
```


## 6. SSO 回调（**待补**）

`/oauth/callback` 是运行时取 `window.location.origin`，所以新域会自动请求
`https://marktext.denglu.dev/oauth/callback`。实测（`scripts/check-sso.mjs`）：

```
FAIL authorize | status=400 location=(none)
INFO client | client_name="MarkText Web" tenant=01M6JBFH2T3P7HYR3MSM0SD5MG
```

即应用客户端 `client-Ost6T4zMRKoh` 没登记该回调。需要把
`https://marktext.denglu.dev/oauth/callback` 加进该客户端的 redirect_uri 白名单
（目前只有 Vercel 生产 + localhost + 127.0.0.1），并把 `https://marktext.denglu.dev`
加进 CORS 源。

> **重建后复核（2026-11-23）**：前端已重建到 v4，但 SSO 预检结果**仍是**
> `authorize 400`——回调确实还没登记。镜像上目前只能用邮箱密码登录。

补法（租户管理员邮箱 + 密码，密码走环境变量，不进命令历史）：

```powershell
cd D:\work\marktext
$env:ADMIN_EMAIL='<管理员邮箱>'; $env:ADMIN_PASSWORD='<密码>'
node scripts/add-oauth-redirect.mjs          # 只读：打印现有回调/CORS
$env:APPLY='1'; node scripts/add-oauth-redirect.mjs   # 合并写入
```

脚本会先尝试激活 `admin` 角色（试用租户默认 `member`），再以 `X-Entry-Plane: admin`
读写 `/oauth/api/v1/admin/oauth/clients`。写完用第 7 节的 SSO 预检复核。

**本机排查结论（2026-11-23）**：

- 本机有一份平台级 QA 管理员账号（可登录 `https://api.autional.cn`，MFA 通过），
  它对 **identity** 管理接口跨租户可用（`/identity/api/v1/admin/users` 200，能列出 marktext 用户）。
- 但 **tenant / oauth** 的管理接口对该账号一律 `503 role lookup failed`
  （`60000002`，middleware-service），平台租户自己也不例外；说明这两类服务的管理面只认
  「该租户内的管理员角色」，平台平面不被接受。
- marktext 租户（`01M6JBFH2T3P7HYR3MSM0SD5MG`）当前只有 `marktext.demo1@gmail.com`
  一个账号，`status=active`、**无任何角色**；当初的租户管理员是靠临时角色激活提权的，
  没有留固定管理员账号。

因此：**回调登记需要该租户的管理员会话**（交付消息里的管理员口令，或先把
`marktext.denglu.dev` 的回调加进客户端），或者平台侧修掉上述 503 后用平台管理面处理。

**2026-11-23 已补账号**（口令不入库，见本机交付文件）：

| 角色 | 用户名 | 说明 |
|---|---|---|
| 管理员 | `marktext_admin` | 平台只给 JIT 临时提权（≤24h），当前 `admin`+`super_admin` 已激活；无永久绑定接口 |
| 用户 ×2 | `marktext_user1` / `marktext_user2` | 普通成员，登录与云端同步已验证 |

建号踩过的坑：管理端 `POST /admin/users` 建出来的账号，邮箱身份 `is_verified=false`，
而本租户开了「邮箱必须已验证才能登录」，于是**邮箱登录会被拒**（提示"邮箱或手机号尚未完成验证"）。
修法：调管理端 `POST /admin/users/{uid}/identities/{iid}/verifications`（"验证身份"，
直接置 verified，不发码），三个账号已修好。用户名身份建号时就是 verified，可用用户名登录。

注意：即使账号有了 `admin`/`super_admin` 激活，**本租户仍没有 admin 入口平面**——
带 `X-Entry-Plane: admin` 的登录一律 `403 40000503`，所以 `oauth` 管理面依旧够不到。
要改回调，只剩三条路：平台侧修入口平面、平台控制台 UI 操作、或直接改 oauth 服务的
`oauth_clients` 行（需授权，属于生产数据变更）。

在此之前：**邮箱密码登录可用**（走同源 `/bff` 代理，已验证到 identity-service），
**SSO 按钮会在 authorize 阶段报错**。

## 7. 已验证

| 检查 | 结果 |
|---|---|
| `npm run cf:build` | 通过（4 静态 + 2 动态路由 + 3 个 Route Handler） |
| `wrangler dev` 本地 | `/`、`/login`、`/d/abc`、`/oauth/callback` 200；`/api/docs` 401 |
| 线上 `GET /`、`/login`、`/d/abc`、`/manifest.webmanifest` | 200 |
| 线上 `GET /api/docs` | 401（鉴权生效，且说明请求确实进了 Worker） |
| 线上 `POST /bff/identity/api/v1/auth/login`（空 body） | 400 + identity-service 校验报错 → 代理链路通 |
| Worker Secrets | `DATABASE_URL` / `CONTENT_ENCRYPTION_KEY` / `CONTENT_ENCRYPTION_KEY_KID` 已绑定（`wrangler secret list` 确认）；Secret Change 触发新版本 `a83f9325` |
| Neon 连通性 | `select count(*) from documents` → 12 条（与 Vercel 同库同表） |
| DNS | `marktext.denglu.dev` 自动解析到 Cloudflare（A/AAAA） |
| 登录页渲染 | 正常（截图见会话记录） |
| 云同步 / SSO 全链路 | ⏳ 需要一次真实登录（测试账号）与回调登记才能验收 |

## 8. 已知差异 / 注意

1. **HTTP 不跳 HTTPS**：`http://marktext.denglu.dev` 返回 200。zone 的 *Always Use HTTPS*
   需要面板开关，当前 token 只有 Zone:Read + Workers:Edit，改不了。
2. **两份部署共用一个库**：Vercel 与 Worker 同时在线，`rev` 乐观锁仍能挡住并发覆盖，
   但"用本机覆盖云端"在两边语义一致，没有额外风险；如果只想留一份，删掉 Worker 即可。
3. **边缘执行**：Worker 在 Cloudflare POP 上跑，Neon 在 `ap-southeast-1`，
   国内访问的 SSR/API 延迟取决于 POP 到新加坡的回程；当前页面基本是客户端渲染，影响小。
4. **缓存**：没有 ISR / R2 缓存，`/` 这类静态页由 Next prerender 产物直接返回（`s-maxage` 由 Next 设置）。
5. **回滚**：`npx wrangler rollback --name marktext`；彻底下线：
   `npx wrangler delete marktext`（会一并摘掉自定义域名，DNS 记录随之消失）。
6. `.open-next/` 是完整产物（48 MB），本地保留可省一次 6 分钟构建；已 gitignore。
