# Autional 接入配置（MarkText Web）

## 租户

| 项 | 值 |
|---|---|
| 租户名 / slug | `marktext-web` |
| tenantId | `01M6JBFH2T3P7HYR3MSM0SD5MG` |
| Issuer | `https://api.autional.cn` |
| API（BFF，同源代理） | `/bff` → `https://api.autional.cn/bff` |
| 生产地址 | https://marktext-web.vercel.app |
| 管理员邮箱 | `jd7438716@gmail.com` |
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

| 邮箱 | 密码 | 用途 |
|---|---|---|
| `marktext.test1@gmail.com` | `Test#Marktext1` | 隔离测试 A |
| `marktext.test2@gmail.com` | `Test#Marktext2` | 隔离测试 B |
| `marktext.test3@gmail.com` | `Test#Marktext3` | 隔离测试 C |

> 测试账号由公开注册接口创建（`POST /identity/api/v1/auth/register`）。
> 生产使用请改为真实邮箱，或由管理员在后台创建。

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

## SSO（可选，未启用）

Skill 的 SSO 路径需要独立应用客户端（`client_id` + 回调 + CORS）。当前无法通过 API 创建：

- 管理接口 `/oauth/api/v1/admin/oauth/clients` 要求 `X-Entry-Plane: admin` 的令牌；
- 邮箱密码登录得到的是 `entry_plane: "api"` 的令牌，网关返回 `403 40000503`；
- 管理员平面令牌只能由管理门户 OAuth 流程签发。

启用步骤（需要在管理后台手工完成）：

1. 打开 `https://admin.autional.cn/marktext-web/oauth-clients`，新建应用：
   - 回调：`https://<你的域名>/oauth/callback`
   - CORS：`https://<你的域名>`（无路径、无尾斜杠）
   - 网站：`https://<你的域名>`
   - 公开客户端（`isConfidential: false`，`clientAuthMethods: ["none"]`）
2. 把拿到的 `client_id` 写入 `NEXT_PUBLIC_AUTIONAL_APP_ID`。
3. 重新构建/部署；登录页会出现「使用 Autional SSO 登录」。
4. 预检：
   ```bash
   curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Accept: application/json" \
     "https://api.autional.cn/oauth/api/v1/oauth/authorize?response_type=code&client_id=$APP_ID&redirect_uri=$(node -p 'encodeURIComponent(process.env.CB)')&scope=openid&state=preflight&code_challenge=mR_nE7EeJopQmji77eZUdD4_rLzw5A5HdlRSiLQQCzU&code_challenge_method=S256"
   ```
   期望 `302` 且回跳到你的回调、带 `error=login_required`。

## 启动 / 部署

```bash
npm install
npm run dev            # http://localhost:3000
npm run build && npm start
```

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
