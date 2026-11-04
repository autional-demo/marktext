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

function RetrySplash({
  text,
  onRetry,
}: {
  text: string;
  onRetry: () => void;
}) {
  return (
    <div className="splash">
      <div className="splash-logo">M↓</div>
      <p>{text}</p>
      <button className="primary" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

/** 登录门禁 + 工作区。页面路由只负责把 initialDocId 传进来。 */
export default function AppGate({ initialDocId }: { initialDocId?: string }) {
  const {
    user,
    isLoading,
    isAuthenticated,
    authIssue,
    retryAuth,
  } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) return;
    // 只有“确实没有会话 / 凭证失效”才跳登录；
    // transient（网络/5xx）与 config（配置错误）留在原地可重试。
    if (authIssue === "transient" || authIssue === "config") return;

    const next = window.location.pathname + window.location.search;
    router.replace(
      next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login",
    );
  }, [isLoading, isAuthenticated, authIssue, router]);

  if (isLoading) return <Splash text="正在加载会话…" />;

  if (!isAuthenticated) {
    if (authIssue === "transient") {
      return (
        <RetrySplash
          text="暂时无法连接认证服务，正在保留本地内容。"
          onRetry={() => void retryAuth()}
        />
      );
    }
    if (authIssue === "config") {
      return (
        <RetrySplash
          text="认证配置异常，请检查应用客户端与租户配置。"
          onRetry={() => void retryAuth()}
        />
      );
    }
    return <Splash text="正在跳转登录…" />;
  }

  if (!user) return <Splash text="正在加载会话…" />;

  return <Workspace userId={user.id} initialDocId={initialDocId} />;
}
