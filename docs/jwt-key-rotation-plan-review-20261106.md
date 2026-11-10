verdict: REJECT
has-blocker: true

> 一句话理由：v1.1 修好了 v1.0 的两条主要错误，但**核心安全语义仍与代码不符**——对外 JWKS 会永久保留启动期公钥（撤销/retire 对外不成立），且 Top 5 漏掉了它自己声明"必须同批"的 P0 G1；再叠加 SAML 线上未适配（可能签发无 kid token），按这份手册做下一次生产轮换有直接事故路径。

审查对象：`docs/JWT-KEY-ROTATION-PLAN.md` v1.1（558 行）
关联核对：`docs/audits/jwt-key-rotation-plan-review-20261106.md`、`docs/IDENTITY-TENANT-APP-TOKEN-PLAN.md` §3.8/§3.11、`docs/IDENTITY-TENANT-APP-TOKEN-HANDOFF.md`、`docs/audits/ops-jwks-path-20261106.md`
方法：只读代码核对（secret / oauth / core / SDK / 4 签发方 / secret-client）+ 关联文档交叉核对。证据等级 E1=代码直读（file:line）、E2=文档断言、E3=推断。

---

## 1. 文档内部矛盾

| # | 章节 | 矛盾点 | 建议 |
|---|---|---|---|
| D1 | §0.1 vs §12 | §0.1 说"其中**两条** P0"；§12 实际有 **4 条** P0（G1/G2/G14/G15） | 改为"4 条 P0，其中 G14/G15 直接改变运行手册动作" |
| D2 | §5.1:209 / §12 G15:446 vs §12.3:457-463 | G15 明确"**修 G15 必须与 G1 同批**"，但 Top 5 **不含 G1**（G1 自己是 P0） | Top 5 第 2 项拆成 "2a 文档口径（可立即做）/ 2b reload 实现（必须与 G1 同批）"；G1 进 Top 5 |
| D3 | §0.2:29-30 vs §8.2:319 | 目标写"零客户改代码"，但 §8.2 的 `jwks` 模式要求客户"配 audience/issuer；**升级 SDK**" | 目标改为"userinfo/introspect 零改码；jwks 需升级 SDK 并遵守 §8.2 契约" |
| D4 | §0.2:29 vs §12 G4 | 目标写"401 尖峰 ≤ 轮询周期（60s）"，但 SDK JWKS 缓存 300s 且无未知 kid 重取（G4 说"最长 5min 401"） | 目标按客户端类型分列：内部 ≤60s、SDK ≤300s（G4 修完前） |
| D5 | §4.3:163 vs §4.4:172 | §4.3 写 status "当前 10s"，§4.4 写"oauth status 30s"，§8.2/§4.4 又写"SDK ≤25s" | 统一为"服务端新鲜度 = oauth keyset 30s；SDK 端到端 ≤55s；10s 只是响应体 `cache_seconds` 建议值（当前无 Cache-Control）" |
| D6 | §5.1:188 vs §5.3:249 | 预发布等待：§5.1 是 `max(JWKS 缓存, keyset 轮询)×2`（≈600s，含 SDK 300s），§5.3 是"≥1h 或 ≥2×最大缓存" | 只留一个公式，并写明"最大缓存"取值来源（内部 60s / oauth 30s / SDK 300s / 外部客户未知） |
| D7 | §7.1:291 vs §6.7:270 + §12 G2:433 | 一处要"旧私钥 escrow 30 天供回滚"，一处要"清理 `secret_secret_versions` 中的旧版本"——escrow 与 purge 互斥，未写"应急场景优先 purge、放弃回滚" | 明确两种模式：例行=escrow；应急=purge 且显式声明不可回滚 |
| D8 | §12.3:465 vs §0.1:21 | 门禁两套口径：§0.1 是"两条 P0 修好前不可自动化"，§12.3 是"完成 Top 5 前只能受限使用" | 只保留一个 Release Gate，并列出 gate 项到 G 号 |
| D9 | §12 G24:455 | 标"✅ HANDOFF 已同步"，但 `HANDOFF:99` 仍写"当前轮换窗口必须包含 `docker restart cloud-monolith`" | 把 HANDOFF §3 P2 同步为历史/已闭环，或把 G24 改回 ⚠️ |
| D10 | §3:110-112 | RFC 7638 行判 ✅"kid 用 thumbprint，稳定且唯一"，但 JWKS 同时发布固定 `v1`（OIDC 钥）——非 thumbprint | 该行限定"JWT 共享钥用 thumbprint；OIDC `v1` 为固定标识，见 G10" |
| D11 | §12 结构 | 有 `### 12.3 Top 5`，却无 12.1/12.2 | 改为 `## 12` 表 + `### 12.1 Top 5`，或补 12.1/12.2 |
| D12 | 与 `PLAN §3.8:244` | 摘要写"overlap ≥24h+30s"，本文写"≥24h+5min+60s+30s"（=24h6m30s） | 摘要同步为 24h6m30s，否则"唯一运行口径"不成立 |

---

## 2. 事实不符（文档断言 vs 代码事实）

- **F1（blocker / 安全）** `shared/service-oauth/internal/handler/handler.go:1423-1429`（+ `cmd/server/main.go:610`） | 文档多处断言"撤销后的旧公钥不再出现在 keyset/JWKS""retire 到点即过滤""旧公钥 24h 后自动过期"；实际 `JWKS` 在 keyset 之后**无条件**追加进程启动时抓到的 `h.JWTSPublicKey`，既不查 `revoked_kids` 也不查 `retire_after`，且该字段启动后不再刷新 ⇒ 只要旧钥是 oauth 启动时的 active 钥，它就会**永久**留在对外 JWKS。 | falsify: 等本次演练旧 kid（`4muY…`）归档`retire_after`过期（>24h）后执行 `curl -s https://api.autional.cn/.well-known/jwks.json \| jq '[.keys[].kid]'`——若旧 kid 仍在，则"retire/撤销即移出 JWKS"为假；或单测：`JWTSPublicKey=K1` + keyset 仅含 K2 + `revoked_kids=[K1]`，断言响应不含 K1（当前会失败）。 | result: **confirmed**（E1，代码路径确定；`JWTSPublicKey` 仅 main.go:610 赋值一次） | **blocker**

- **F2（blocker / 可用性）** `docs/IDENTITY-TENANT-APP-TOKEN-HANDOFF.md:85` + `shared/service-core/util/jwt/jwt.go:517-528` | 文档 §5.2/§6 以"旧 token 仍可验、签发侧最多 5min 仍用旧 kid"为前提；但 HANDOFF 明确 **SAML 未部署 v1.0.67**（旧二进制在线），旧二进制很可能不写 `kid`。而 `ParseToken` 在多键 keyset 下对**无 kid** token 直接返回 `kid is required for multi-key set` ⇒ 第一次 rotate 后 keyset 变多键，SAML 签发的 no-kid token 立即 401（不是 24h 后）。 | falsify: staging 留一份 v1.0.67 前的 saml 二进制，rotate 前后各签一枚 token 打任一资源服务；或直接解码线上 SAML 登录返回的 token header 看有无 `kid`。 | result: **unverified**（需线上二进制/真实 token），但"缺这条前置门禁"是 confirmed（E1+E2） | **blocker**

- **F3（blocker / 流程）** `docs/JWT-KEY-ROTATION-PLAN.md:209,446,457-463` | §5.1 与 G15 都写"缩短签发延迟必须同时实现 G1 的 stage/publish"，但 Top 5 没有 G1；按 Top 5 施工 = 先把唯一的**事实预发布窗口**（5min 凭据缓存）抹掉，再谈 stage。 | falsify: 只做 G15（提供 reload/降 TTL）不动 rotate，rotate 后立刻 reload——新 kid 在 verifier keyset（60s/30s）落地前就签发，`jwt.go:511` 返回 `unknown kid`。 | result: **confirmed**（E1 逻辑路径） | **blocker**

- **F4（should-fix / 安全）** `shared/service-secret/internal/service/jwt_keyset.go:212-238`（另 `:182-199`） | 文档 G16 只写"RMW 非原子/并发可丢撤销"；实际更常见的是**读失败**：`RevokeJWTKid` 读 `jwt/state` 出错时用空 state 覆盖写并 `version++` ⇒ 既有撤销集合被**整体擦除**且版本前进；`bumpJWTKeyState` 读失败则回落 `version=1`。SDK 侧 `middleware.ts:205` 反回滚只挡版本下降，挡不住"版本前进但集合变短"。 | falsify: stub `getSecretScoped(jwt/state)` 返回 error，先 revoke K1（成功）再 revoke K2（读失败）→ 再读 state：`revoked_kids=[K2]`、version=N+1（K1 丢失）。 | result: **confirmed**（E1） | **should-fix（P1）**

- **F5（blocker / 运维）** `shared/service-share/micro-pkg/secret-client/config.go:41-43` + `shared/service-core/micro-middleware/app/bootstrap_sources.go:199-208` + `service-secret/internal/router/router.go:148-154` | §6.2/G15 把"临时降低 secret-client TTL 或增加签发方 reload"写成可用手段；实际 `TTLRefreshInterval` 无任何可运维入口（`bootstrap_sources.go` 装配处未传，只能改代码重发；全仓只有 secret-client 内部默认 5min），仓库也没有任何 reload 端点（JWT 组只有 keys/keyset/private-key/rotate/revoke）。 | falsify: `rg -n "TTLRefreshInterval" shared` 只有默认值；`rg -n "reload" service-secret/internal/router` 无命中。 | result: **confirmed**（E1） | **blocker（应急手册不可执行）**

- **F6（should-fix / SLO）** `PLAN §4.4:172` vs `service-oauth/cmd/server/main.go:568-571` + `internal/client/keyset.go:54-63` + `sdk/.../middleware.ts:195` | 文档断言"SDK ≤25s（10s + 15s）"，漏掉 oauth 的 keyset 缓存 **30s**（status 内容就取自它）⇒ 最坏 ≈ 30+10+15 = **55s**。 | falsify: t0 revoke，t0+5/15/25 连续 `curl /.well-known/jwt-status.json`，可见 version/revoked 直到 ~t0+30 才更新；再加 SDK 结果缓存 15s。 | result: **confirmed**（E1+算术） | **should-fix**

- **F7（should-fix / 安全）** `service-secret/internal/config/config.go:171`，全仓无 prune（`rg "PruneVersions\|DeleteVersion"` = 0） | G21/§7.1 写"默认保留 100 版"；实际 `MaxVersions=100` 只是策略字段，**没有任何删除路径**，版本历史无上限 ⇒ 旧私钥永久可被 `secret:admin` 读回，`destroy` 更不可达。 | falsify: 连续 store 同一 key 101 次，`select count(*) from secret_versions where secret_id=…` >100。 | result: **confirmed**（E1） | **should-fix**

- **F8（should-fix / 安全）** `shared/service-core/util/jwt/jwt.go:410-435,530-535` + `micro-middleware/auth/jwt.go:73-80` | §3/§8.1 断言内部"校验 alg=RS256"；实际配置了 `Secret` 时 `allowedMethods` = RS256+**HS256**，且 HMAC 分支直接返回 secret、**不校验 kid**；`AUTH_ALLOW_HS256` 默认 true。 | falsify: 用共享 `JWT_SECRET` 签一枚 HS256、无 kid 的 token 打任一已配置 Secret 的服务 → 200。 | result: **confirmed**（E1；v1.0 评审 §6 提过"⚠️ 非严格"，v1.1 正文没保留） | **should-fix**

- **F9（should-fix / 可用性）** `jwt_keyset.go:154-157` | 文档/代码注释均暗示"归档失败则中止轮换、旧 token 宽限期内可验"；实际 `archiveCurrentJWTPublicKey` 在**读当前公钥失败**时返回 `(false, nil)`，rotate 继续 ⇒ 不归档、旧 token 立刻全 401。 | falsify: stub 读 `jwt/public-key` 返回 error，调 rotate → 200，`jwt/verify/<oldkid>` 不存在。 | result: **confirmed**（E1） | **should-fix**

- **F10（should-fix / 安全）** `service-identity/internal/handler/self_service_handler.go:1376-1403` + `micro-middleware/auth/stepup.go:116-128` | §2.1/§5 断言"AT/RT/**step-up** 都写 kid"且受 keyset 撤销约束；实际 step-up 用**新建 Config**（未设 `ActiveKID/ActiveKIDFromKey/UseGlobalPrivateKey`）签 → 无 kid，且用的是 `h.jwtCfg.PrivateKey`（**启动私钥**）；验签侧只看 `globalJWTPublicKey`（启动公钥）。⇒ step-up 面永不轮换、不受 keyset 撤销、跨重启版本不一致。 | falsify: rotate 后不重启 identity 取 step-up token 解 header（无 kid，签名可用启动私钥验过）；再重启任一资源服务 → 其 `globalJWTPublicKey` 变新钥，step-up 立即 401。 | result: **confirmed**（E1） | **should-fix**

- **F11（should-fix / 观测）** `service-oauth/internal/handler/handler.go:1505` | §4.3 把"status 当前 10s"当服务端缓存；实际 10 只是响应体 `cache_seconds` 常量，且两处端点都**没有** `Cache-Control/ETag`（G19 已承认后者，未承认前者）。 | falsify: `curl -i .../jwt-status.json` 无缓存头；t0 revoke，t0+15 的 `version` 可能未变。 | result: **confirmed**（E1） | **should-fix**

- **F12（should-fix / 运维）** `service-secret/internal/handler/jwt_keyset_handler.go:68-79` | §6.3 把 revoke 当"确认生效"的动作；`RevokeJWTKid` 不校验 kid 是否存在/是否在 keyset，错 kid 也返回 `revoked:true` ⇒ 应急时假成功。 | falsify: `POST /revoke {"kid":"typo"}` → 200 `{"revoked":true}`，state 里多一条无用条目。 | result: **confirmed**（E1） | **should-fix**

- **F13（should-fix / 证据）** `docs/IDENTITY-TENANT-APP-TOKEN-HANDOFF.md:38` | 文档 §2 把"prod 轮换演练：无 5xx、旧 AT 仍 200、新登录新 kid 200"列为现状证据，但仓库内**没有**原始证据：无 `lite/<slug>/test.log`、无 curl 输出/截图/时间线文件（`glob **/rotation*20261106*` 空）。 | falsify: 以上两处查找均无产物，只剩 HANDOFF 一行自述。 | result: **confirmed 缺失**（按"无原始日志不得判 PASS"记 hardening） | **should-fix**

- **F14（nit / 配置耦合）** `bootstrap.go:933-944` | 文档预检只列 `JWT_KEYSET_REFRESH_SECONDS`，未列 `JWT_ALLOWED_ISSUERS`；keyset 轮询按该 env 建 issuer→kid 映射，缺失时只挂 `keyset.Issuer`（默认 `https://api.autional.cn`），`identity-service` 旧 issuer 的 token 会落 `unknown kid`。 | falsify: 去掉某服务 `JWT_ALLOWED_ISSUERS`、用 `iss=identity-service` 的 token 打它 → 401 `unknown kid`。 | result: **confirmed**（E1） | **nit**

- **F15（should-fix / 攻击面）** `service-secret/internal/router/router.go:156-160` + `jwt_keyset.go:47` + `secret_service_impl.go:824-845` | G14 只把自愈链归到 provision/keyset 内部调用；实际**未认证的公网** `GET /api/v1/secret/public/jwt/keyset` 也走 `GetJWTKeySet→GetJWTPublicKey→(私钥读失败)→EnsureJWTKeyPair→RotateJWTKeyPair`，即公网只读端点可间接触发换钥。 | falsify: 断开读私钥（stub error）后匿名 GET 公网 keyset → 触发 `jwt_rotate` 审计事件。 | result: **confirmed**（E1） | **should-fix**

---

## 3. 生产事故风险

### P0-1 撤销/泄漏应急"移出 JWKS"无效（F1）
- 触发：泄漏应急 revoke 旧 kid（或例行 retire）后，该 kid 恰是 oauth 进程启动时的 active 钥。
- 影响：对外 JWKS 永久保留该公钥；只做 JWKS 本地验签、不读 status 的外部 RP（§8.3 推荐路径）**继续接受**用泄漏钥签的 token；§4.4/§6.4 的"key omission 传播 ≤60s"对外不成立。SDK 因为读 status 才不受影响，掩盖了问题。
- 整改：`JWKS` 仅在 `JWTKeySetClient==nil` 或取数失败时使用静态钥；使用前按 `revoked_kids` 过滤；或把静态钥也纳入 keyset 版本管理。
- 验收：单测（静态钥=K1、keyset 含 K2、revoked=[K1] → 响应无 K1）+ 线上 rotate 后 >24h 的 `jq '.keys[].kid'` 不含旧 kid。

### P0-2 SAML 未适配 + 无 kid 签发方（F2）
- 触发：按 §5.2 直接 rotate；SAML 线上仍是 v1.0.67 前二进制（HANDOFF:85）。
- 影响：keyset 变多键后，SAML 签发的 no-kid token 被 `kid is required for multi-key set` 拒绝 → SAML 登录链路 401；若旧二进制带 kid 但无热刷新，则 24h 后 retire 旧钥同样打断。
- 整改：§5.2 预检加"逐签发方实测 token header 有 kid 且 rotate 后 6min 内切新 kid"，SAML 单独列 gate（先升级或明确排除并公告）；§6 加"无 kid 签发方不在撤销保护内"。
- 验收：staging 用旧 saml 二进制跑 rotate，前后 token 均可验。

### P0-3 按 Top 5 执行会先抹掉预发布窗口（F3）
- 触发：团队按 §12.3 顺序完成第 2 项（G15 reload/降 TTL），未做 G1。
- 影响：rotate 后签发立即切新 kid，而 verifier keyset 需 60s（内部）/30s（oauth）才更新 → 新 token `unknown kid` 401，正好制造文档承诺要避免的尖峰。
- 整改：G1 进 Top 5 且排在 G15 的"缩短延迟"之前；或 G15 只做文档口径，reload 功能挂到 G1 之后。
- 验收：staging 记录 rotate→首个新 kid 的时间，同时 keyset 里新 kid 的时间 ≤ 该时间（即"先发布后签发"）。

### P1-1 撤销被静默擦除（F4）
- 触发：`jwt/state` 一次读失败（DB 抖动/解密失败）时执行 revoke。
- 影响：历史 revoked 集合清空且 version 前进；SDK 接受新版本后永久丢失撤销信息（重启后更彻底）。
- 整改：revoke/bump 读失败必须 fail（不得用空 state 覆盖）；state 改 CAS；加 `jwt_state_write_conflict_total` 与"revoked 集合长度不得下降"断言。
- 验收：注入读失败后 revoke 返回 5xx 且集合不变；并发 50 次集合完整。

### P1-2 应急手册没有"停签"手段（F5）
- 触发：确认密钥泄漏，按 §6 执行。
- 影响：只能等 5min 凭据缓存自然过期；期间新登录/refresh 用已撤销 kid 签发 → 签发即被拒（可用性），操作员没有可执行动作，容易误用 DB 回滚（文档自己列为红线）。
- 整改：先实现 reload/降 TTL（G15）再写进 §6；在此之前 §6 必须写"当前只能等待 ≤5min，禁止 DB 回滚"。
- 验收：staging 执行 §6 全流程，revoke 后 0 个新 token 使用旧 kid。

### P1-3 step-up 面不轮换、不受撤销（F10）
- 触发：例行/应急 rotate；或轮换后重启任一资源服务。
- 影响：step-up token 永远由启动私钥签发、无 kid；泄漏时被撤销的钥仍可签发**提权凭证**；服务重启后 step-up 验签跨版本不一致 → 敏感操作 401。
- 整改：step-up 配置改为 `UseGlobalPrivateKey=true + ActiveKIDFromKey=true`；验签侧改用全局 keyset；纳入 §8.1 契约与 G17 撤销面。
- 验收：rotate 后 step-up header 有 kid=新 active；revoke 旧 kid 后旧 step-up 401。

### P2 观测/SLO 误导（F6/F11/F18）
- 触发：按文档 25s/10s 做验收。
- 影响：撤销 SLO 实际 ~55s，验收会假通过；`cache_seconds` 被当服务端缓存。
- 整改：SLO 按通道分列并写计算式；status 加 `Cache-Control: max-age=10` 或把 oauth keyset TTL 降到 10s。
- 验收：曲线法测 t0→SDK 拒绝的最坏值。

---

## 4. 遗漏场景（文档 §10 混沌矩阵缺）

1. **全撤销/空 keyset**：`refreshGlobalJWTKeys` 在 `len(keys)==0` 时返回错误并**保留上一版**（bootstrap.go:929-931）⇒ 把所有 kid 都撤销后，内部验签方反而永久信任旧钥。
2. **oauth 启动静态钥残留**（F1）：不是并发问题，是稳态问题，且当前 prod 正在发生。
3. **无 kid 签发方**（SAML 旧二进制；任何回落路径）：多键 keyset 立即 401（F2）。
4. **step-up 专用签名面**（F10）：独立于 keyset 的第二套"半静态"密钥。
5. **rotate 风暴**：27 服务 provision 相位相同（同一批发布），一次 DB 抖动可并发触发多次 rotate（G14 只写"并发 10 次"，没写"同相位放大"）。
6. **state 读失败**：撤销擦除 + version 回退锁死 SDK 反回滚闸门（F4）。
7. **公网 keyset 端点触发自愈旋转**（F15）。
8. **备份中的私钥副本生命周期**：§5.2 每次轮换 `pg_dump` 一份（含加密私钥），未规定保留期/销毁，与 §6.7/§7.1 的 destroy 目标冲突。
9. **多区（.cn/.com）issuer**：keyset `issuer` 默认硬编码 `https://api.autional.cn`（jwt_keyset_handler.go:31-33,54-57），status 用单值 `resolveIssuerFromConfig()`；多区部署时文档未说明该字段仅供参考。
10. **时钟偏差叠加**：signer 时钟超前 >30s 时，`iat/nbf` 与 `retire_after` 的 30s skew 预算不足（公式只加一次 30s）。

---

## 5. 标准对齐（核对结论）

| 标准条款 | 文档声称 | 实际 | 结论 |
|---|---|---|---|
| RFC 7517 §4 JWK | ✅ | `kty/use/alg/kid/n/e/key_ops` 齐全（handler.go:1449-1458） | ✅ 成立 |
| RFC 7515 §4.1.4 kid | ✅ | AT/RT 由 `ActiveKIDFromKey` 派生并写入；**step-up 不写** | ⚠️ 部分（F10） |
| RFC 7638 thumbprint | ✅ | `{e,kty,n}` 规范序列 + SHA-256，与 JWKS `e/n` 同源 | ✅ 成立（`v1` 例外见 D10） |
| RFC 8725 §3.1 算法白名单 | ✅/⚠️（单键回退） | 配置 Secret 时 RS256+HS256 同时允许；HMAC 路径不校验 kid | ❌ 文档低估（F8） |
| RFC 8725 §3.9 未知 kid | ✅/⚠️ | 多键集拒绝；单公钥回退 | ✅ 陈述准确 |
| RFC 9068 typ/client_id/iss/aud | ❌/⚠️ | typ 未设、内部不校验；client_id 在 `custom`；identity/SAML 旧 iss/aud 非 URL | ✅ 陈述准确（诚实） |
| RFC 9700 撤销传播 | ✅/⚠️（故障期不成立） | 正常期内部 60s；SDK ~55s；**对外 JWKS 因静态钥永不撤销** | ❌ 对外结论不成立（F1） |
| OIDC Discovery | ✅ | `issuer` 稳定、`jwks_uri` 同源（handler.go:986） | ✅ 成立 |
| NIST SP 800-57 cryptoperiod | ✅/部分 | 无 `activate_at`、无 destroy、版本历史无上限 | ✅ 自评"部分"尚可，但 G21 描述偏乐观（F7） |
| OWASP JWT | ✅/部分 | 固定 URL、白名单（含 HS256）✅；缓存 300s+无未知 kid 重取 ⚠️ | ✅ 陈述准确 |

**结论**：没有发现"凭空声称合规"的段落；问题集中在**继承代码缺陷却给出 ✅ 结论**的两行（RFC 8725 算法、RFC 9700 撤销）。

---

## 6. Top 5 评估

**顺序合理性**：第 1 项 G14（自愈式破坏性轮换）排第一正确——它是唯一能"无人操作即换钥"的缺陷。第 3/4/5 项分组也合理。

**问题**：
1. **缺 G1**（P0，且被 G15 显式依赖）——这是最严重的排序缺陷（P0-3）。
2. **缺 G8**（指标）——§13 验收里"指标/告警正常（G8 未上线则标 N/A）"使可观测验收恒空转，建议至少先上 `jwt_rotate_total` + `jwt_unknown_kid_total` 两个计数器（半人日）。
3. **缺 G7**（rotate 响应回传私钥）——改动小、直接降低私钥外泄面，且能去掉"必须 `-o /dev/null`"的人为依赖。
4. **缺 G4**（SDK 未知 kid 重取）——它直接决定"零客户改代码/401 不超轮询周期"这两个顶层目标能否成立。
5. **G15 应拆两步**：文档口径（今天可做）/ reload 实现（必须与 G1 同批），否则 Top 5 第 2 项会把团队推向 P0-3。
6. **验收可执行性**：第 1 项"注入读错误 24h 内 jwt_rotate=0"依赖故障注入设施（仓库无），需注明用 staging 单测/stub 实现；其余可执行。

**建议 Top 6（顺序）**：
`G14 → G1 → G15(文档) → G3+G23 → G16(+读失败路径)+G17+G20 → G12+G18+G19`，并把 G7/G8 作为"轮换前低成本必做"并行项。

---

## 7. 必须修正项（按顺序，最多 8）

1. **改口 + 改码：对外 JWKS 的撤销/退休语义**（F1）。文档 §2/§4.2/§4.4/§6.4/§7.1 全部修正；代码修 `JWKS` 静态兜底（或把静态钥纳入 keyset）。这是安全承诺，不是措辞问题。
2. **Top 5 加入 G1，并把 G15 拆成"文档口径 / reload 实现"**（F3、D2）。补一条 Release Gate：任何"缩短签发延迟"的改动必须与 stage/publish 同批。
3. **SAML / 无 kid 签发方 gate**（F2）：§5.2 预检加"逐签发方 token header 有 kid"；SAML 未适配前不得执行 rotate，或先把 SAML 排除并公告影响面。
4. **§6 应急手册改为"当前可执行"版本**（F5、F12）：删掉不可用的 TTL/reload 手段（或标注"待 G15"），加"revoke 前先确认 kid ∈ 当前 keyset"，加"禁止 DB 回滚"红框。
5. **补 step-up 面**（F10）：文档 §2.1/§8.1 修正"step-up 写 kid"；整改项并入 G12/G17（使用全局私钥 + keyset）。
6. **G16 扩到读失败路径**（F4）：revoke/bump 读失败必须失败返回，不得空 state 覆盖；验收加"集合长度不下降 / version 单调"。
7. **数值口径统一**（F6、F11、D5）：SLO 按通道给计算式（内部 60s / SDK 55s / 外部客户自定）；status 的 10s 说明来源与缓存头现状。
8. **证据与台账**（F13、F7）：演练补原始日志（命令+输出+退出码）到 `lite/<slug>/test.log` 或 `docs/audits/`；G21 改"版本历史无上限（无 prune）"并给 purge 方案与备份销毁期限。

---

## 8. 契约卡（安全/一致性接口）

| 接口 | 参数 | 返回值 | 失败降级 | 反例（可执行） |
|---|---|---|---|---|
| `POST /internal/secret/jwt/rotate` | `X-API-Key` + `X-Tenant-ID`(strict) + `X-Namespace`∈S；无 body | 200 + **新私钥 PEM**；副作用：归档旧公钥、覆盖 priv/pub、bump state | 无锁；archive 读失败**静默继续**；pub 写失败时 priv 已换（错配） | 并发两次 rotate → `prv(kid)` 与 keyset `active_kid` 可不等；stub 读 pub 失败 → 200 但 `jwt/verify/<old>` 缺失，旧 AT 立刻 401 |
| `POST /internal/secret/jwt/revoke` | `{kid, reason}` | `{kid, revoked:true}`（不校验 kid 存在） | state 读失败 → 用空 state 覆盖（撤销集合被擦除） | revoke 两个 kid 中间注入读失败 → 第一个 kid 从 `revoked_kids` 消失且 version++ |
| `GET /secret/public/jwt/keyset`（匿名） | 无 | active+verify 公钥、`revoked_kids`(含 reason)、`version`、`require_kid_after`、`issuer`(默认硬编码 .cn) | 读失败走自愈链，**可触发 rotate** | 匿名 GET + 私钥读失败 → 产生 `jwt_rotate` 审计事件 |
| `GET /.well-known/jwks.json` | 无 | OIDC `v1` + keyset(过滤 revoked) + **启动静态钥** | keyset 失败 → stale/nil，仍有静态钥（200，不是 5xx） | rotate 后 >24h，`jq '.keys[].kid'` 仍含启动期旧 kid |
| `GET /.well-known/jwt-status.json` | 无 | `version/active_kid/revoked_kids/require_kid_after/cache_seconds=10` | 上游 keyset 30s 缓存；失败用进程内 env 值 | revoke 后 t0+15 仍返回旧 version；`curl -I` 无 Cache-Control |
| 内部 keyset 轮询（60s） | `JWT_KEYSET_REFRESH_SECONDS≥10` | 覆盖全局 keyset | 失败保留上一版；**空集也保留** | 全部 kid 撤销 → 轮询报 "no usable keys" 并继续信任旧钥 |
| SDK `verify:'jwks'` | `issuer/audience/appId/jwksTtlMs/cacheTtlMs` | `VerifiedUser` | JWKS 300s、status 10s、结果 15s；无未知 kid 重取 | rotate 后 5min 内新 kid 请求 401；`iss` 缺失的签名正确 token 通过（middleware.ts:272） |
| step-up 签发/验签 | 无 kid；签名=启动私钥；验签=`globalJWTPublicKey` | access 型 step-up token | 私钥不可得 → HS256 回退 | rotate 后签发的 step-up header 无 kid；重启任一服务后旧 step-up 401 |

---

## 9. 通过也举证（判为通过/非目标点的实体）

- **RFC 7638 thumbprint 实现正确**：`jwt_keyset.go:242-269` 与 `util/jwt/global_keys.go:63-79` 使用 `{e,kty,n}` 字典序 + RawURLEncoding。`falsify:` 对同一公钥跑 OpenSSL/自算 thumbprint 对比。`反事实:` 若字段顺序非字典序或含 `alg/use`，kid 会漂移且跨语言不兼容（当前不会）。证据等级：E1。
- **5min 签发延迟的判断准确**：`secret-client/config.go:41-43` 默认 5min、`bootstrap.go:743-768` 60s ticker 只读进程缓存。`falsify:` 把 `JWT_PRIVATE_KEY_REFRESH_SECONDS=10` 观察仍不提前切 kid。`反事实:` 若 ticker 直连 DB，则 60s 口径成立（当前不）。E1。
- **G6/G8/G13/G22/G23 的"缺失"判断成立**：`refreshGlobalJWTKeys` 不消费 `revoked_kids/require_kid_after`（bootstrap.go:897-931）；全仓无 `jwt_rotation_*`；skills 仍写"不要用公开 JWKS"（`sdk/skills/_core/PROCEDURE.md:1134`）；`List(...,1,200)`；state 无时间锚。`falsify:` 对应 `rg` 命中为 0 / 结构体字段缺失。E1。
- **prod 演练"已完成"不能判 PASS**：仅 HANDOFF:38 一行叙述，无原始日志（F13）。`falsify:` 找不到 test.log/curl 输出/截图。`反事实:` 若有 `lite/.../test.log` 含 `rotate` 命令+HTTP 码+JWKS 快照，则可判 pass。证据等级：E2（自述）。
- **AT/RT TTL 口径准确**：`util/jwt/jwt.go:282-288` access 优先 `ShortAccessExpiry=5m`；`defaults.go:9` RT=24h，且 `docs/CENTER-MIGRATION-RESULT.md:96` 记录 prod `token.refresh_token_expiry: "24h"`。`falsify:` 解一枚真实 RT 看 `exp-iat`。E1+E2。
- **SDK 缓存/校验事实**：300s/10s/15s、无未知 kid 重取、`iss` 空放行、`typ` 缺失放行、模块级单例。`falsify:` `middleware.ts:165/195/272/248` 直读 + 双实例串味测试。E1。

---

## 10. 未看范围 / 限制

- 未直连 prod（无法验证：SAML 线上二进制是否写 kid、真实 token 的 iss/aud、JWKS 是否仍含 `4muY…`、`refresh_token_expiry` 实际值、`AUTH_ALLOW_HS256` 实际值）。
- 未读：service-tenant 的签发接线、gateway/BFF 的 JWT 处理、`service-core` 其余 keyset 消费点（27 服务逐个核对超出本次范围；抽查 identity/oauth/session/saml 四个签发方）。
- 未核对：`secret_secret_versions` 的 RLS/审计细节、`sdk/packages/node` 的测试用例、`service-maml` 旧二进制行为。
- 本次未执行任何写操作；未运行测试。

declined:
- 不评"90 天是否最优周期"（属策略偏好，非正确性）。
- 不评文档排版/措辞（除影响执行者判断的歧义外）。
- 不评 `docs/archive/jwks-per-tenant-20261105/` 的历史方案。
- 不提出"合并 service-core 子模块/重构 keyset 服务"类建议（违反仓库禁令，且非本次目标）。
