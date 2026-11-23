import type { NextConfig } from "next";

/**
 * 缓存头集中在这里：
 * - service worker / 清单不能长缓存，否则用户会卡在旧版本
 * - PWA 图标可缓存一周
 * - /api、/bff 是用户数据，任何中间层都不许缓存
 */
const commonHeaders = [
  {
    source: "/sw.js",
    headers: [
      { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
    ],
  },
  {
    source: "/manifest.webmanifest",
    headers: [{ key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" }],
  },
  {
    source: "/icons/:path*",
    headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
  },
  {
    source: "/api/:path*",
    headers: [{ key: "Cache-Control", value: "no-store" }],
  },
  {
    source: "/bff/:path*",
    headers: [{ key: "Cache-Control", value: "no-store" }],
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: false,
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    // 开发环境额外禁用页面缓存，避免热更新被浏览器缓存吃掉
    if (process.env.NODE_ENV !== "production") {
      return [
        ...commonHeaders,
        {
          source: "/:path*",
          headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
        },
      ];
    }
    return commonHeaders;
  },
};

export default nextConfig;
