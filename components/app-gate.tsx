"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import Workspace from "./workspace";

function Splash({ text }: { text: string }) {
  return (
    <div className="splash">
      <div className="splash-logo">M↓</div>
      <p>{text}</p>
    </div>
  );
}

/** 登录门禁 + 工作区。页面路由只负责把 initialDocId 传进来。 */
export default function AppGate({ initialDocId }: { initialDocId?: string }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const next = window.location.pathname + window.location.search;
      router.replace(next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) return <Splash text="正在加载会话…" />;
  if (!isAuthenticated || !user) return <Splash text="正在跳转登录…" />;

  return <Workspace userId={user.id} initialDocId={initialDocId} />;
}
