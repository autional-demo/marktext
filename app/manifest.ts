import type { MetadataRoute } from "next";

/**
 * PWA 清单。
 * - icons 同时提供 192/512 PNG 与 SVG：Chrome 装桌面要 192/512，Safari 认 PNG，
 *   maskable 变体用于 Android 自适应图标（避免被裁掉字形）。
 * - shortcuts 让长按图标能直达「新建文档」。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MarkText Web",
    short_name: "MarkText",
    description: "网页版 Markdown 编辑器，云端同步，离线可写。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "zh-CN",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "新建文档",
        short_name: "新建",
        url: "/?new=1",
        description: "打开 MarkText Web 并新建一篇文档",
      },
      {
        name: "打开工作区",
        short_name: "工作区",
        url: "/",
        description: "回到最近编辑的文档",
      },
    ],
  };
}
