# 项目记录 — MarkText Web

> 本文件只记录可公开的信息。账号密码、个人邮箱等凭据不写入仓库，由交付人单独提供。

## 1. 交付内容

| # | 交付 | 状态 |
|---|---|---|
| 1 | MarkText 桌面版 | 保持 0.17.1（用户选择不升级） |
| 2 | MarkText Web（muya 内核） | 已上线 Vercel |
| 3 | Autional 登录 | 邮箱密码 + SSO（OAuth 2.0 + PKCE） |

## 2. 线上与代码

| 项 | 值 |
|---|---|
| 生产地址 | https://marktext-web.vercel.app |
| 部署源仓库 | https://github.com/autional-demo/marktext （分支 `main`） |
| 本地 remote | `origin`（同一仓库） |
| Vercel 项目 | `marktext-web`（team `jd7438716-gmailcoms-projects`） |
| 生产分支 | `main` |
| 自动部署 | push 到 `main` → Vercel 生产；其他分支 → Preview |
| 归档分支 | `feature/autional` |

> `autional-demo/marktext` 的默认分支仍是 `develop`（上游 MarkText 代码）；应用在 `main`。

## 3. 身份配置（公开信息）

| 项 | 值 |
|---|---|
| 租户 | `marktext-web` / `01M6JBFH2T3P7HYR3MSM0SD5MG` |
| Issuer | `https://api.autional.cn` |
| API（同源代理） | `/bff` → `https://api.autional.cn/bff` |
| 应用客户端 | `client-Ost6T4zMRKoh`（`kind=app`，公开 + PKCE） |
| 授权入口 | `https://auth.autional.cn/oauth/api/v1/oauth/authorize` |
| Scope | `openid profile email offline_access` |
| 回调 | `/oauth/callback`（生产 + localhost + 127.0.0.1） |
| 角色激活 | 管理员接口需 `X-Entry-Plane: admin`；试用账号用 `role-activations` 临时提权 |

门户（按租户 slug 路由）：

| 门户 | 地址 |
|---|---|
| 管理后台 | https://admin.autional.cn/marktext-web/ （平台侧 404） |
| 用户门户 | https://user.autional.cn/marktext-web/ |
| 安全仪表盘 | https://security.autional.cn/marktext-web/ |
| 开发者门户 | https://developer.autional.cn |
| 系统状态 | https://status.autional.cn |

## 4. 环境变量

生产（Vercel 项目环境变量）：

```
NEXT_PUBLIC_AUTIONAL_TENANT_ID=01M6JBFH2T3P7HYR3MSM0SD5MG
NEXT_PUBLIC_AUTIONAL_ISSUER=https://api.autional.cn
NEXT_PUBLIC_AUTIONAL_API_URL=/bff
NEXT_PUBLIC_AUTIONAL_APP_ID=client-Ost6T4zMRKoh
```

服务端专用（不要加 `NEXT_PUBLIC_`）：

```
DATABASE_URL=postgresql://...-pooler...neon.tech/neondb?sslmode=require
CONTENT_ENCRYPTION_KEY=<32 字节 base64>
CONTENT_ENCRYPTION_KEY_KID=k1
```

`CONTENT_ENCRYPTION_KEY` 用于文档标题与正文的字段级加密。**丢失即无法解密已有文档**，必须在密码管理器中另存一份。

本地配置在 `.env.local`（已 gitignore）。生产环境变量在 Vercel 项目里。

本地：复制 `.env.example` 为 `.env.local`。

## 5. 常用命令

```bash
npm install
npm run dev                 # 本地开发
npm run build && npm start  # 生产构建

# SSO 预检（authorize 302 + CORS 204）
APP_ID=client-Ost6T4zMRKoh \
CALLBACK=https://marktext-web.vercel.app/oauth/callback \
ORIGIN=https://marktext-web.vercel.app \
node scripts/check-sso.mjs

# 集成测试（discovery/register/login/profile/token/logout/revoked）
TENANT_ID=01M6JBFH2T3P7HYR3MSM0SD5MG \
TEST_EMAIL=<测试邮箱> TEST_PASSWORD=<测试密码> \
node scripts/integration-test.mjs

# 发布
git push origin main        # origin = autional-demo/marktext（触发部署）
```

## 6. 验证结果

| 检查 | 结果 |
|---|---|
| 构建 | 通过（4 静态 + 2 动态路由） |
| 集成测试 | 8/8 |
| SSO authorize 预检 | 302，回指回调（`error=login_required`） |
| SSO CORS 预检 | 204 + `Access-Control-Allow-Origin` |
| 授权码换票 | 200 + access_token |
| userinfo | 200，邮箱正确 |
| 生产 `/bff` 代理换票 | 200 |
| 生产页面 | 200 |
| 生产密码登录 | 200（管理员与测试账号） |
| Git 触发部署 | 多次 READY（`githubCommitRef=main`） |
| 文档云同步（本地 E2E） | 13/13（`scripts/e2e-local.mjs`，含 401/创建/列表/读取/保存/409/密文/删除） |
| 字段加密 | 库内为 `v1:` 密文；AAD 绑定租户+用户+文档+字段；篡改拒绝 |

## 7. 关键决策

1. **不直接部署 MarkText**：它是 Electron 桌面应用；改用其官方 web 内核 muya。
2. **同源 `/bff` 代理**：identity API 的 CORS 白名单不含本域，浏览器直连预检被拒。
3. **不用 portal 客户端**：`client-YqzCy3ZOwQur` 是 `kind=portal`，回调固定在 auth 域。
4. **编辑器事件挂 `document`**：muya 会重建宿主节点，挂宿主上的监听器会失效。
5. **提权方式**：试用租户是 `member`，用 `role-activations` 申请 `admin`（1 小时）后建客户端。
6. **文档走服务端而非浏览器直连**：浏览器直连数据库需要 RLS 策略，漏一条即全表公开；改为 Next.js Route Handler + JWKS 验签，授权逻辑在 TypeScript 里。
7. **正文与标题字段级加密**：AES-256-GCM，密钥在 Vercel 环境变量；Neon 只能看到密文。代价是失去服务端正文检索（当前无此需求）。
8. **本地优先同步**：localStorage 作为离线缓存，Neon 为真源；用 `rev` 做乐观并发控制，冲突时由用户选择保留哪版。

## 8. 已知问题 / 待办

| 项 | 说明 |
|---|---|
| 浏览器点击 SSO 未验证 | 本机浏览器代理不稳定（`ERR_PROXY_CONNECTION_FAILED`）；API 级全链路已通过 |
| 云同步 | 已接入 Neon Postgres（ap-southeast-1）；localStorage 仅作本地缓存与离线兜底 |
| 试用租户残留 | 已清理（2026-11-04，9 个空租户全部删除，仅保留 `marktext-web`） |
| 测试账号 | `marktext.test1` 因风控验证码已删除，由 `marktext.demo1` 替代；密码见交付消息 |
| 管理门户 404 | `admin.autional.cn/<slug>/` 平台侧返回 404 |
| fork 默认分支 | 仍为 `develop`；如需访客直达应用代码，可改为 `main` |

## 9. 时间线

| 日期 | 事件 |
|---|---|
| 2026-11-04 | 安装/确认 MarkText 0.17.1；构建 MarkText Web |
| 2026-11-04 | 创建 Autional 试用租户，接入密码登录 |
| 2026-11-04 | 首次 CLI 部署到 Vercel |
| 2026-11-04 | 创建应用客户端，启用 SSO（OAuth 2.0 + PKCE） |
| 2026-11-04 | 发布到 GitHub，Vercel 改为 Git 联动 |
| 2026-11-04 | README 补在线地址；新增 `PROJECT_NOTES.md` |
| 2026-11-04 | 清理 9 个空试用租户；重建测试账号（`demo1` 替代 `test1`） |

## 10. 凭据

管理员密码、测试账号密码、个人邮箱**不在本仓库**。请向交付人索取。

> 当前可用测试账号：`marktext.demo1@gmail.com`、`marktext.test2@gmail.com`、`marktext.test3@gmail.com`（密码见交付消息）。
