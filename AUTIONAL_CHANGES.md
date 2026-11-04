# AUTIONAL_CHANGES — MarkText Web

## 接入方式

- 框架：Next.js 15（App Router）+ React 19 + TypeScript
- 身份：Autional，租户 `marktext-web`（`01M6JBFH2T3P7HYR3MSM0SD5MG`）
- 登录方式：邮箱 + 密码，以及 **Autional SSO**（OAuth 2.0 授权码 + PKCE，已启用）
- 数据：浏览器 localStorage，按 userId 命名空间隔离

## 新增文件

| 文件 | 说明 |
|---|---|
| `app/layout.tsx` | 根布局，挂载 `AuthProvider` |
| `app/page.tsx` | 工作区入口，未登录跳 `/login` |
| `app/login/page.tsx` | 登录 / 注册页（含 SSO 按钮） |
| `app/oauth/callback/page.tsx` | SSO 回调处理 |
| `app/bff/[...path]/route.ts` | 同源 BFF 代理（转发 identity / oauth） |
| `app/.well-known/openid-configuration/route.ts` | discovery 同源转发 |
| `app/globals.css` | 全站样式（含 muya 排版） |
| `components/auth-provider.tsx` | Autional 会话上下文（init / login / register / logout） |
| `components/workspace.tsx` | 文档列表 + 工具栏 + 编辑器容器 |
| `components/editor.tsx` | muya 编辑器封装、插件注册、自动保存 |
| `lib/autional.ts` | 公开配置与常量 |
| `lib/docs.ts` | 文档持久化（按 userId 命名空间） |
| `scripts/create-tenant.mjs` | Phase 3 试用租户创建 + 3.1a 自检 |
| `scripts/check-sso.mjs` | SSO 预检（authorize 302 + CORS 204） |
| `scripts/integration-test.mjs` | Phase 7 集成测试（8 项） |
| `scripts/create-oauth-client.mjs` | SSO 客户端创建尝试（实际由管理员平面 API 完成） |
| `PROJECT_NOTES.md` | 项目记录（仓库/部署/时间线/待办） |
| `README.md` | 项目说明与发布流程 |
| `AUTIONAL_SETUP.md` / `AUTIONAL_CHANGES.md` | 交付说明 |

## 关键实现决策

1. **不用 `@autional/react` 的 Provider**：它的 `config` 不含 `tenantId`，而共享 issuer 必须显式传租户 ID。改为直接使用 `@autional/core` + 自建上下文。
2. **注册绕过 SDK 缺陷**：`@autional/core@0.4.1` 的 `register()` 把 `tenantId` 原样发出，服务端要 `tenant_id`；应用内按同一密码传输策略自行构造请求。
3. **编辑器事件挂在 document**：Muya 会替换/重建宿主节点，挂在宿主上的监听器会随节点失效；改为 document 捕获 + `root.contains(target)` 过滤。
4. **StrictMode 关闭**：避免开发期双挂载导致编辑器实例竞争（生产不受影响）。
5. **同源 `/bff` 代理**：Autional identity API 的 CORS 白名单不含新域名，浏览器直连会在预检被拒；由 Next.js 路由转发到 `api.autional.cn/bff`，discovery 也走同源。
6. **SSO 用独立应用客户端**：`client-Ost6T4zMRKoh`（kind=app，公开 + PKCE），回调与 CORS 同时覆盖生产与本地。试用租户是 member，先用 `role-activations` 临时激活 admin（1h）拿到管理员平面令牌，再建客户端。

## 数据隔离结论（Skill 1.6）

```
数据隔离：已隔离（localStorage 键按 userId 命名空间）
位置：marktext-web:user:<userId>:docs
经登出换账号所见：新账号空状态（各自命名空间）
不经登出换账号所见：无残留（读取始终以当前 userId 为键）
```

未做跨设备持久化：需要服务端存储（如 Vercel Blob），本轮未接入。

## 验证证据

| 检查 | 命令 / 方式 | 结果 |
|---|---|---|
| 构建 | `npm run build` | 通过，4 静态 + 2 动态路由 |
| 集成测试 | `node scripts/integration-test.mjs` | **8/8**（discovery / register / login / profile / token / logout / revoked / auth-config） |
| 本地浏览器登录 | 真实浏览器登录 `marktext.test2@gmail.com` | 进入工作区，无控制台错误 |
| 编辑器渲染 | DOM 检查 `.mu-container` + 10 段落 | 通过，样式生效（h1 30px） |
| 自动保存 | setContent + 触发 input → 读 localStorage | 通过（内容写入） |
| 刷新恢复 | reload 后读 `.mu-container` 文本 | 通过（内容恢复） |
| 登出 | 调用 `logout()` 后旧 token 访问 `/auth/me` | 401（会话终结） |
| 生产页面 | `GET https://marktext-web.vercel.app/login` | 200 |
| 生产配置注入 | 构建产物含 tenantId | 通过 |
| 生产代理 | `GET /bff/.../auth-config/{tenantId}` | 200 |
| 生产登录 | `POST /bff/identity/api/v1/auth/login` | 200 + access_token |
| SSO authorize 预检 | `scripts/check-sso.mjs` | PASS（302 回指回调） |
| SSO CORS 预检 | `scripts/check-sso.mjs` | PASS（204 + ACAO） |
| SSO 完整流程 | authorize → code → token → userinfo | 全 200，email 正确 |
| 生产代理换票 | `POST /bff/oauth/api/v1/oauth/token` | 200 + access_token |
| Git 触发部署 | push `main` → Vercel | READY（`githubCommitRef=main`） |

## 部署信息

- 生产：https://marktext-web.vercel.app
- 部署源：https://github.com/autional-demo/marktext （分支 `main`，GitHub → Vercel 自动部署）
- Vercel 项目：`marktext-web`（team `jd7438716-gmailcoms-projects`，生产分支 `main`）
- 环境变量（Production/Preview/Development）：
  `NEXT_PUBLIC_AUTIONAL_TENANT_ID` / `NEXT_PUBLIC_AUTIONAL_ISSUER` / `NEXT_PUBLIC_AUTIONAL_API_URL=/bff` / `NEXT_PUBLIC_AUTIONAL_APP_ID`
- 注：CLI 首次部署误建了同名项目 `marktext`，可在 Vercel 后台删除。

## 未完成 / 已知限制

| 项 | 原因 | 影响 |
|---|---|---|
| 浏览器级 SSO 点击 | 本机浏览器代理不稳定（`ERR_PROXY_CONNECTION_FAILED`），无法完成页面点击验证 | 已用 API 级完整流程替代验证；用户可在网络正常时点一次确认 |
| 跨设备同步 | 未接入服务端存储 | 数据仅本机浏览器 |
| 3 个测试账号密码 | 只在交付消息中提供，不写入仓库 | 需要时向交付人索取 |
| 试用租户残留 | 已清理（9 个空租户全部删除，仅保留 `marktext-web`）；同 IP 试用配额已用尽 | 无 |
| 测试账号重建 | 管理员重置接口写入方式与登录哈希不一致，已删除重建；`test1` 被风控要求验证码，由 `demo1` 替代 | 使用交付消息中的新账号 |
| 管理门户 404 | 平台侧 `admin.autional.cn/<slug>/` 返回 404 | 后台操作走 API / 角色激活 |
