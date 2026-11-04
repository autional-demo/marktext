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
- 文档按账号隔离，云端自动保存，导入 / 导出 `.md`
- **每条笔记独立 URL**（`/d/<id>`），支持刷新、深链、浏览器前进后退
- **PWA**：可安装到桌面/主屏幕，离线可打开，恢复联网后自动同步
- 深浅色跟随系统

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15（App Router） |
| UI | React 19 + 原生 CSS |
| 编辑器 | `@muyajs/core` 0.2.0（muya） |
| 身份 | `@autional/core` + 自建 Context |
| 存储 | Neon Postgres（服务端，字段级 AES-256-GCM 加密）+ localStorage 本地缓存 |
| PWA | `app/manifest.ts` + `public/sw.js`（导航 network-first，静态资源 cache-first） |
| 部署 | Vercel（函数区域固定 `sin1`） |

## 本地运行

```bash
npm install
cp .env.example .env.local
# 填入 DATABASE_URL 与 CONTENT_ENCRYPTION_KEY（见下方「数据库」）
node --env-file=.env.local scripts/migrate.mjs   # 建表（幂等）
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
# 公开，会打进前端产物
NEXT_PUBLIC_AUTIONAL_TENANT_ID=01M6JBFH2T3P7HYR3MSM0SD5MG
NEXT_PUBLIC_AUTIONAL_ISSUER=https://api.autional.cn
NEXT_PUBLIC_AUTIONAL_API_URL=/bff
NEXT_PUBLIC_AUTIONAL_APP_ID=client-Ost6T4zMRKoh

# 服务端专用，不要加 NEXT_PUBLIC_ 前缀
DATABASE_URL=postgresql://...-pooler...neon.tech/neondb?sslmode=require
CONTENT_ENCRYPTION_KEY=<32 字节 base64>
CONTENT_ENCRYPTION_KEY_KID=k1
```

> `NEXT_PUBLIC_*` 会打进前端产物，不要放密钥。

## 数据库

| 项 | 值 |
|---|---|
| 供应商 | Neon Postgres（`ap-southeast-1`） |
| 连接 | 用 pooled 连接串（主机名带 `-pooler`） |
| 建表 | `node --env-file=.env.local scripts/migrate.mjs` |
| 加密 | 标题与正文 AES-256-GCM，密文前缀 `v1:<kid>:` |

**注意**：`CONTENT_ENCRYPTION_KEY` 丢失后已有文档无法解密。请在密码管理器中另存一份；轮换密钥需要保留旧 key 才能读旧数据。

## 数据与同步

- 本机 localStorage 是缓存，Neon 是真源
- 输入停止约 1.6 秒后写云端（编辑器 400ms + 同步 1.2s 防抖）
- 用 `rev` 做乐观并发控制，冲突时由用户选择「载入云端」或「用本机覆盖」
- 令牌失效时顶部会出现「重新登录」提示，本机改动不丢

## 常用命令

```bash
node --env-file=.env.local scripts/migrate.mjs    # 建表 / 升级表结构
node --env-file=.env.local scripts/e2e-local.mjs  # 本地端到端（不碰真实账号）
```

## 目录

```
app/           路由（/、/d/[id]、/login、/oauth/callback、/bff 代理、/api/docs）
components/    认证上下文、登录门禁、工作区、编辑器、PWA 注册
lib/           Autional 配置、路由工具、文档缓存与 API 客户端
lib/server/    服务端专用：数据库连接、身份校验、字段加密、文档校验
db/            Postgres 表结构
public/        图标与 service worker
scripts/       租户创建、SSO 预检、集成测试、数据库迁移、本地 E2E
```

## 参考

- 在线地址：https://marktext-web.vercel.app
- 接入细节与运维：`AUTIONAL_SETUP.md`（含登录失败排查表）
- 变更与验证记录：`AUTIONAL_CHANGES.md`
- 项目记录（仓库/部署/时间线）：`PROJECT_NOTES.md`
