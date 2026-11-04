"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

export default function OAuthCallbackPage() {
  const { autional } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      try {
        await autional.handleOAuthCallback(window.location.href);
        if (!cancelled) router.replace("/");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "登录回调处理失败。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autional, router]);

  return (
    <div className="splash">
      <div className="splash-logo">M↓</div>
      {error ? (
        <>
          <p className="login-error">{error}</p>
          <button className="primary" onClick={() => router.replace("/login")}>
            返回登录页
          </button>
        </>
      ) : (
        <p>正在完成登录…</p>
      )}
    </div>
  );
}
