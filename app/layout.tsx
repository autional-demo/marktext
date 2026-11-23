import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import PwaRegister from "@/components/pwa-register";

/**
 * 注意：muya 的 core.css（约 140 KB）不在这里引入。
 * 它只被编辑器需要，现在跟着 editor 的异步 chunk 一起加载，
 * 登录页 / 回调页 / 404 不再为编辑器样式付费。
 */

export const metadata: Metadata = {
  title: "MarkText Web — 多人 Markdown 写作空间",
  description:
    "基于 MarkText 编辑器内核（muya）的网页版 Markdown 编辑器，使用 Autional 单点登录，文档按账号隔离。",
  applicationName: "MarkText Web",
  appleWebApp: {
    capable: true,
    title: "MarkText",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1f22" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
