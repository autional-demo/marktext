# MarkText Web

网页版 Markdown 编辑器：编辑器内核来自 [MarkText](https://github.com/marktext/marktext) 的 **muya**（`@muyajs/core`），身份与多用户由 [Autional](https://www.autional.cn) 提供。

> MarkText 本身是 Electron 桌面应用，无法直接部署到 Vercel。本项目用同一编辑器内核构建 web 版本，再部署到 Vercel。

**在线体验：https://marktext-web.vercel.app** · **代码仓库：https://github.com/autional-demo/marktext**（分支 `main`）

## 功能

- CommonMark + GFM：标题、列表、任务列表、表格、代码块、引用、脚注
- 行内格式工具栏、快捷插入菜单、查找替换、撤销/重做
- KaTeX 数学公式、Mermaid 图表（由 muya 提供）
- 账号登录 / 注册（Autional，邮箱 + 密码，SHA-256 哈希传输）
- **Autional SSO 登录**（OAuth 2.0 授权码 + PKCE，公开客户端）
- 文档按账号隔离，自动保存，导入 / 导出 `.md`
- 深浅色跟随系统

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15（App Router） |
| UI | React 19 + 原生 CSS |
| 编辑器 | `@muyajs/core` 0.2.0（muya） |
| 身份 | `@autional/core` + 自建 Context |
| 存储 | localStorage（按 userId 命名空间） |
| 部署 | Vercel |

## 本地运行

```bash
npm install
cp .env.example .env.local   # 已含公开配置；补上 NEXT_PUBLIC_AUTIONAL_TENANT_ID
npm run dev
```

打开 http://localhost:3000 ，注册账号或使用测试账号登录。

## 构建

```bash
npm run build
npm start
```

## 发布流程（GitHub → Vercel）

| 项 | 值 |
|---|---|
| GitHub | https://github.com/autional-demo/marktext （公开，分支 `main`） |
| Vercel 项目 | `marktext-web`（已绑定该仓库，生产分支 `main`） |
| 自动部署 | push 到 `main` → 生产部署；其他分支 → Preview |

```bash
git push origin main     # 触发 Vercel 生产部署
```

> `origin` 就是部署源 `autional-demo/marktext`（分支 `main`）。

CLI 仅作兜底：`npx vercel --prod`。

生产环境变量：

```
NEXT_PUBLIC_AUTIONAL_TENANT_ID=01M6JBFH2T3P7HYR3MSM0SD5MG
NEXT_PUBLIC_AUTIONAL_ISSUER=https://api.autional.cn
NEXT_PUBLIC_AUTIONAL_API_URL=/bff
NEXT_PUBLIC_AUTIONAL_APP_ID=client-Ost6T4zMRKoh
```

> `NEXT_PUBLIC_*` 会打进前端产物，不要放密钥。

## 目录

```
app/           路由（/、/login、/oauth/callback、/bff 代理）
components/    认证上下文、工作区、编辑器
lib/           Autional 配置、文档存储
scripts/       租户创建、SSO 预检、集成测试
```

## 参考

- 在线地址：https://marktext-web.vercel.app
- 接入细节与运维：`AUTIONAL_SETUP.md`（含登录失败排查表）
- 变更与验证记录：`AUTIONAL_CHANGES.md`
- 项目记录（仓库/部署/时间线）：`PROJECT_NOTES.md`
