# Autional 接入配置（MarkText Web）

## 租户

| 项 | 值 |
|---|---|
| 租户名 / slug | `marktext-web` |
| tenantId | `01M6JBFH2T3P7HYR3MSM0SD5MG` |
| Issuer | `https://api.autional.cn` |
| API（BFF，同源代理） | `/bff` → `https://api.autional.cn/bff` |
| 生产地址 | https://marktext-web.vercel.app |
| 管理员邮箱 | 见交付消息（不写入公开仓库） |
| 状态 | active |

> 管理员密码只在创建时显示一次，未写入任何文件。请存入密码管理器。

## 门户（按租户 slug 路由）

| 门户 | 地址 | 用途 |
|---|---|---|
| 管理后台 | https://admin.autional.cn/marktext-web/ | 用户 / 角色 / 安全策略 / 审计 |
| 用户门户 | https://user.autional.cn/marktext-web/ | 改密码 / 设备 / MFA |
| 安全仪表盘 | https://security.autional.cn/marktext-web/ | 登录趋势 / 风险事件 |
| 开发者门户 | https://developer.autional.cn | 文档（全局） |
| 系统状态 | https://status.autional.cn | 服务状态（全局） |

> 说明：门户页面当前返回 404，属平台侧（我们仅按 Skill 记录地址）。

## 测试账号

已创建 3 个测试账号（`marktext.test1/2/3@gmail.com`）。
**邮箱与密码只在交付消息中提供**，不写入仓库（仓库可能公开）。

## 为什么用同源代理

Autional 的 identity API 走 **CORS 白名单**，默认只放行自有门户域名。
从 `https://marktext-web.vercel.app` 直接调用会在预检阶段被拒（`OPTIONS` 返回 404，无 `Access-Control-Allow-Origin`）。

因此应用把 `NEXT_PUBLIC_AUTIONAL_API_URL` 设为 `/bff`，由 Next.js 路由
`app/bff/[...path]/route.ts` 转发到 `https://api.autional.cn/bff`；
`app/.well-known/openid-configuration/route.ts` 转发 discovery。
浏览器只与同源通信，不触发 CORS。

## 环境变量

`.env.local`（已 gitignore）：

```env
NEXT_PUBLIC_AUTIONAL_TENANT_ID=01M6JBFH2T3P7HYR3MSM0SD5MG
NEXT_PUBLIC_AUTIONAL_ISSUER=https://api.autional.cn
NEXT_PUBLIC_AUTIONAL_API_URL=/bff
NEXT_PUBLIC_AUTIONAL_APP_ID=
NEXT_PUBLIC_AUTIONAL_AUTHORIZE_URL=https://auth.autional.cn/oauth/api/v1/oauth/authorize
```

- `NEXT_PUBLIC_AUTIONAL_TENANT_ID` 必填：issuer 为共享域名，SDK 无法从子域推导租户。
- `NEXT_PUBLIC_AUTIONAL_APP_ID` 留空 = 只启用邮箱密码登录；填写后登录页出现 SSO 按钮。

## 登录方式

当前启用：**邮箱 + 密码**（租户 `login_methods` 已包含 `password`）。

- 密码传输：`hash` 模式，`SHA-256(password + "|" + tenantId)`，由 SDK 自动处理。
- 注册：应用内自行调用 `POST /identity/api/v1/auth/register`（`tenant_id` 为 snake_case），
  因为 `@autional/core@0.4.1` 的 `register()` 发送 `tenantId`，会被服务端拒绝。
- 会话：SDK 管理 token；401 时自动刷新；多 Tab 通过 `syncTabs` 同步。

## SSO（已启用）

| 项 | 值 |
|---|---|
| appId | `client-Ost6T4zMRKoh` |
| 类型 | 应用客户端（`kind=app`，公开客户端，PKCE，无 secret 认证） |
| 回调 | `https://marktext-web.vercel.app/oauth/callback`、`http://localhost:3000/oauth/callback`、`http://127.0.0.1:3000/oauth/callback` |
| CORS 源 | 上述三个 origin（无路径、无尾斜杠） |
| 授权入口 | `https://auth.autional.cn/oauth/api/v1/oauth/authorize` |
| Scope | `openid profile email offline_access` |

登录页显示「使用 Autional SSO 登录」；点击后跳授权页，回调走 `/oauth/callback`。

### 实测结果

| 检查 | 结果 |
|---|---|
| authorize 预检 | `302`，回指回调并带 `error=login_required` |
| CORS 预检 | `204`，`Access-Control-Allow-Origin: https://marktext-web.vercel.app` |
| 完整授权码流程 | authorize(带用户令牌) → `code` → token `200` → userinfo `200`（email 正确） |
| 生产 `/bff` 代理换票 | `200`，返回 access_token |

### 开通方式（可复现）

试用租户的成员角色是 `member`，管理员接口返回 `403 40000503`。用平台自带的**角色激活**临时提权：

1. 申请管理员角色（立即生效，默认到期自动失效）：
   ```bash
   POST /identity/api/v1/auth/me/role-activations
   { "role_id": "01M6JBFH36MH3KFESGM6V5TBR3", "duration": "1h", "justification": "..." }
   ```
   （`admin` / `super_admin` 的 role_id 可从 `/auth/me/role-activations/available-roles` 获取）
2. 用 `X-Entry-Plane: admin` 重新登录，获得管理员平面令牌。
3. 调 `POST /oauth/api/v1/admin/oauth/clients` 建应用客户端（带回调与 CORS）。
4. 角色激活 1 小时后自动过期；本次已用毕（客户端已建）。

> 注意：`client-YqzCy3ZOwQur` 是租户 **portal** 客户端（`kind=portal`），
> 唯一回调是 `https://auth.autional.cn/oauth/callback`，**不能**当应用 appId 用。

### 预检命令

```bash
APP_ID=client-Ost6T4zMRKoh \
CALLBACK=https://marktext-web.vercel.app/oauth/callback \
ORIGIN=https://marktext-web.vercel.app \
node scripts/check-sso.mjs
```

期望两项都 PASS：authorize 302 回指回调；CORS 204 且 ACAO = 源。

## 启动 / 部署

```bash
npm install
npm run dev            # http://localhost:3000
npm run build && npm start
```

### 发布（GitHub → Vercel）

- GitHub：`https://github.com/autional-demo/marktext`，生产分支 `main`
- Vercel 项目 `marktext-web` 已与该仓库联动；push 到 `main` 即自动部署
- CLI 兜底：`npx vercel --prod`

Vercel 环境变量（Production）：

```
NEXT_PUBLIC_AUTIONAL_TENANT_ID=01M6JBFH2T3P7HYR3MSM0SD5MG
NEXT_PUBLIC_AUTIONAL_ISSUER=https://api.autional.cn
NEXT_PUBLIC_AUTIONAL_API_URL=/bff
```

## 数据隔离

- 文档按 `marktext-web:user:<userId>:docs` 命名空间存放于浏览器 localStorage。
- 切换账号只读当前 userId 命名空间，不显示他人的文档。
- 已知限制：数据仅在当前浏览器；换设备/清缓存不保留。跨设备需接入服务端存储。
