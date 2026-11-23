import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext Cloudflare 适配器配置（部署到 https://marktext.denglu.dev）。
 *
 * 本应用没有用 ISR / on-demand revalidation（所有路由都是 force-dynamic 或客户端组件），
 * 所以不启用 R2/KV 增量缓存，用适配器默认的空缓存即可，少一个需要运维的桶。
 * 如果以后要用 ISR，按官方文档加 `r2IncrementalCache` 与 `NEXT_INC_CACHE_R2_BUCKET`。
 */
export default defineCloudflareConfig({});
