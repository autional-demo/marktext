"use client";

import { useEffect } from "react";

/** 只在生产环境注册，避免开发时被缓存干扰。 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 注册失败不影响主流程 */
      });
    }, 1500);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
