"use client";

import { useCallback, useEffect, useState } from "react";

const INSTALL_DISMISS_KEY = "marktext-web:install-dismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * PWA 装配：注册 service worker、提示新版本、提示安装。
 * 只在生产环境启用，开发时避免缓存干扰。
 *
 * 更新策略：新 worker 装好后停在 waiting，不自动接管。
 * 用户点「刷新」才 skipWaiting + reload，避免旧页面配新缓存。
 */
export default function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  const applyUpdate = useCallback(() => {
    void (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const target = reg?.waiting ?? reg?.installing ?? null;
      target?.postMessage({ type: "SKIP_WAITING" });
      // controllerchange 里统一 reload；这里只是兜底，避免卡在旧页面
      window.setTimeout(() => window.location.reload(), 2000);
    })();
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let refreshing = false;

    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // 首屏空闲后再注册，别和编辑器抢带宽
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const reg = await navigator.serviceWorker.register("/sw.js", {
            updateViaCache: "none",
          });
          if (cancelled) return;

          if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true);

          reg.addEventListener("updatefound", () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateReady(true);
              }
            });
          });
        } catch {
          /* 注册失败不影响主流程 */
        }
      })();
    }, 1500);

    // 回到前台时检查一次新版本（长时间挂着的 PWA 常见场景）
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.serviceWorker.getRegistration().then((reg) => reg?.update());
    };
    document.addEventListener("visibilitychange", onVisible);

    const onBeforeInstall = (event: Event) => {
      const promptEvent = event as InstallPromptEvent;
      promptEvent.preventDefault();
      if (window.localStorage.getItem(INSTALL_DISMISS_KEY) === "1") return;
      setInstallEvent(promptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    setInstalling(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "dismissed") {
        window.localStorage.setItem(INSTALL_DISMISS_KEY, "1");
      }
    } catch {
      /* 用户取消或浏览器不支持，忽略 */
    } finally {
      setInstallEvent(null);
      setInstalling(false);
    }
  }, [installEvent]);

  if (!updateReady && !installEvent) return null;

  return (
    <div className="pwa-toast" role="status" aria-live="polite">
      {updateReady ? (
        <>
          <span>新版本已就绪</span>
          <button type="button" onClick={applyUpdate}>
            刷新
          </button>
          <button type="button" className="pwa-dismiss" onClick={() => setUpdateReady(false)}>
            稍后
          </button>
        </>
      ) : (
        <>
          <span>把 MarkText 装到桌面，离线也能写</span>
          <button type="button" onClick={() => void install()} disabled={installing}>
            {installing ? "安装中…" : "安装"}
          </button>
          <button
            type="button"
            className="pwa-dismiss"
            onClick={() => {
              window.localStorage.setItem(INSTALL_DISMISS_KEY, "1");
              setInstallEvent(null);
            }}
          >
            不再提示
          </button>
        </>
      )}
    </div>
  );
}
