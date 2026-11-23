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
- 断网可继续编辑；网络恢复自动重试，不会误报“登录失效”
- **本机缓存走 IndexedDB**（不再受 localStorage 约 5 MB 配额限制），重启/离线都不丢
- **本地优先**：默认读本机；打开时与每约 60 秒后台检查更新，干净的改动静默落地，只有真冲突才提示
- **增量同步**：只上传真正变化的字段，只改标题时不会重传整篇正文
- **登录态秒开**：本地会话快照先渲染工作区，令牌校验在后台进行
- **侧栏虚拟列表**：几百篇文档时只渲染可视行
- **每条笔记独立 URL**（`/d/<id>`），支持刷新、深链、浏览器前进后退
- **PWA**：可安装到桌面/主屏幕（192/512 + maskable 图标），离线可打开任意深链，恢复联网后自动同步，新版本就绪时会提示刷新
- 深浅色跟随系统

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15（App Router） |
| UI | React 19 + 原生 CSS |
| 编辑器 | `@muyajs/core` 0.2.0（muya，异步 chunk + 空闲预热） |
| 身份 | `@autional/core` + 自建 Context（本地会话快照 + 后台校验） |
| 存储 | Neon Postgres（服务端，字段级 AES-256-GCM 加密）+ **IndexedDB** 本地缓存 |
| 同步 | 列表只取元数据、正文按需拉取；`PATCH /api/docs/:id` 增量保存 + `rev` 乐观锁 |
| PWA | `app/manifest.ts` + `public/sw.js`（壳预缓存 + 分层缓存 + 构建号自动失效，见下节） |
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

> 心智模型：**本机永远是默认视图，云端只是备胎。** 打开只读本地，更新在后台默默落地。

- 本机 **IndexedDB** 是主视图，Neon 是真源；旧版 localStorage 数据首次启动自动迁移
- **打开**：只读 IndexedDB 上屏，不发任何网络请求就能看到上次的文档，并恢复到上次打开的那一篇
- **检查更新的时机**：打开时 / 每约 60 秒（仅在页面可见，±随机抖动）/ 回到前台 / 恢复联网
- **静默落地**：云端 rev 变了的文档由后台拉取替换，不提示、不打断
- **你正在看的那篇必须提醒**：屏幕上是旧版本时，顶部明确显示「当前显示的是旧版本：云端已到 vN」
  并提供「载入新版」；只有在编辑器有焦点时才会推迟替换（避免光标乱跳）
- **在旧版本上继续改 → 立刻升级为冲突**：提示条变红，说明「云端已到 vN，而你在旧版本（vM）上改过」，
  给出「载入云端（丢弃我的改动）」/「用本机覆盖」两条路；侧栏对应文档同时亮红点
- 不在看的文档替换成功后不打扰；正在看的那篇被后台替换时会闪一句「已载入云端新版」的轻提示
- 差量合并（`lib/merge.ts`）：云端没变的文档原样保留（同一引用），不重渲染、侧栏不重排
- 列表接口只返回元数据，正文按需拉取（切文档、hover、空闲预取，同一篇并发去重）
- 输入停止约 1.6 秒后写云端（编辑器 400ms + 同步 1.2s 防抖）
- **增量保存**：`PATCH /api/docs/:id` 只带变化的字段，只改标题时不重传正文
- 每篇文档带「云端已知版本」的字段指纹（`doc.synced`），无改动时直接跳过请求；
  离线期间改过的内容在下次启动合并时会自动补传
- 用 `rev` 做乐观并发控制，冲突时由用户选择「载入云端」或「用本机覆盖」
- 令牌失效时顶部会出现「重新登录」提示，本机改动不丢
- **首屏**：本地会话快照先渲染工作区（乐观登录），真实令牌校验在后台完成；
  只有「凭证过期/被吊销」才踢回登录页，断网不会误判

## 离线与缓存

| 资源 | 策略 | 原因 |
|---|---|---|
| 应用壳（`/`、`/login`、图标、清单） | install 预缓存 | 装完即可离线打开任意深链 |
| `/_next/static/*` | cache-first | 文件名带内容哈希，天然不可变 |
| 图标 / 字体 / 图片 | stale-while-revalidate | 先给缓存，后台悄悄更新 |
| 页面导航 | network-first + 4s 超时回退缓存 | 弱网不白屏，联网时仍能拿到新版 |
| RSC 载荷 | network-first，离线回退同路径缓存 | 客户端导航离线也能走通 |
| `/api`、`/bff`、`/oauth` | 完全不拦截 | 用户数据不进缓存，也不会卡在旧版本 |

- **版本自动跟随构建**：Vercel 的静态页 HTML 带 Next 构建号（`<!--buildId-->`）；Cloudflare(OpenNext)
  会剥掉该注释，SW 自动退化为「跨页共享 chunk 指纹」。两条路径都只需一次导航就能发现新部署。
  带哈希的旧 chunk 继续复用，只补差量；只有需要**强制清空全部缓存**时才手动提升 `VERSION`。
- **更新**：新 worker 装好后停在 `waiting`，页面底部提示「新版本已就绪 → 刷新」，避免旧页面配新缓存导致白屏。
- **首屏体积**：编辑器内核（muya）及其约 141 KB 的样式走异步 chunk；首屏 CSS 约 10 KB。
- **大列表**：侧栏只渲染视口内的行（500 篇约 30~40 个节点）。
- **验证离线**：`npm run build && npm start` → 打开页面停留约 3 秒（等 SW 装好）→ 停掉服务器 → 刷新任意深链仍能打开。

## 常用命令

```bash
node --env-file=.env.local scripts/migrate.mjs    # 建表 / 升级表结构
node --env-file=.env.local scripts/e2e-local.mjs  # 本地端到端（不碰真实账号）
npm run test:token                                # 令牌刷新分类 / 并发单测
npm run test:boot                                 # 启动会话裁决（乐观登录策略）单测
npm run test:merge                                # 本地优先差量合并单测
```

## 目录

```
app/           路由（/、/d/[id]、/login、/oauth/callback、/bff 代理、/api/docs）
components/    认证上下文、登录门禁、工作区、编辑器、文档列表（虚拟滚动）、加载态、PWA 注册
lib/           Autional 配置、路由工具、文档缓存（IndexedDB）、增量同步 API 客户端
lib/idb.ts     IndexedDB 原语
lib/session.ts 会话快照（乐观登录）
lib/auth-boot.ts 启动会话裁决（纯函数，可单测）
lib/merge.ts   本地优先差量合并（纯函数，可单测）
lib/server/    服务端专用：数据库连接、身份校验、字段加密、文档校验
db/            Postgres 表结构
public/        图标（192/512/maskable）、离线页与 service worker
scripts/       租户创建、SSO 预检、集成测试、数据库迁移、本地 E2E、单测
```

## 参考

- 在线地址：https://marktext-web.vercel.app
- 接入细节与运维：`AUTIONAL_SETUP.md`（含登录失败排查表）
- 变更与验证记录：`AUTIONAL_CHANGES.md`
- 项目记录（仓库/部署/时间线）：`PROJECT_NOTES.md`
