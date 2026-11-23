"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { Splash, Spinner } from "./loading";

/**
 * 工作区（编辑器 + 侧栏，库里还带 muya 内核）体积远大于登录门禁本身，
 * 拆成异步 chunk：未登录用户不再为编辑器付费，登录后再按需下载。
 */
const Workspace = dynamic(() => import("./workspace"), {
  ssr: false,
  loading: () => <Splash text="正在准备编辑器…" detail="首次加载会下载编辑器内核，之后走缓存。" />,
});

/** 首屏慢的时候给一句解释，别让转圈变成「是不是卡死了」。 */
function useSlowHint(delay = 3000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  return slow;
}

function RetrySplash({
  text,
  onRetry,
}: {
  text: string;
  onRetry: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <Splash text={text}>
      <button
        className="primary"
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void Promise.resolve(onRetry()).finally(() => setRetrying(false));
        }}
      >
        {retrying ? (
          <>
            <Spinner size={12} /> 正在重试…
          </>
        ) : (
          "重试"
        )}
      </button>
    </Splash>
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
  const slowHint = useSlowHint();

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

  if (isLoading) {
    return (
      <Splash
        text="正在加载会话…"
        detail={slowHint ? "认证服务响应较慢，正在重试；本机内容不会丢失。" : undefined}
      />
    );
  }

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
