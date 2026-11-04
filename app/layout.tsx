import type { Metadata, Viewport } from "next";
import "@muyajs/core/lib/core.css";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import PwaRegister from "@/components/pwa-register";

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
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
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
