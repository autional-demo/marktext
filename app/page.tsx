"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import Workspace from "@/components/workspace";

export default function HomePage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="splash">
        <div className="splash-logo">M↓</div>
        <p>正在加载会话…</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="splash">
        <div className="splash-logo">M↓</div>
        <p>正在跳转登录…</p>
      </div>
    );
  }

  return <Workspace userId={user.id} />;
}
