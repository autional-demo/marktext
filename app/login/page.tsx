"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { AUTHORIZE_URL, SSO_ENABLED, callbackUri } from "@/lib/autional";

type Mode = "login" | "register";

export default function LoginPage() {
  const { login, register, autional, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }
      router.replace("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败，请稍后重试。";
      setError(message);
      setBusy(false);
    }
  };

  const signInWithSso = async () => {
    setBusy(true);
    setError(null);
    try {
      await autional.loginWithOAuth({
        authorizeUrl: AUTHORIZE_URL,
        redirectUri: callbackUri(),
        scope: "openid profile email",
      });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "无法启动 SSO 登录。");
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">M↓</span>
          <div>
            <h1>MarkText Web</h1>
            <p>多人 Markdown 写作空间</p>
          </div>
        </div>

        <div className="mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <label>
            邮箱
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位，含大小写与数字"
            />
          </label>

          <button type="submit" className="sso-button" disabled={busy}>
            {busy
              ? "正在处理…"
              : mode === "login"
                ? "登录 MarkText Web"
                : "创建账号并登录"}
          </button>
        </form>

        {error && <p className="login-error">{error}</p>}

        {SSO_ENABLED && (
          <>
            <div className="divider">
              <span>或</span>
            </div>
            <button type="button" className="ghost-button" onClick={signInWithSso} disabled={busy}>
              使用 Autional SSO 登录
            </button>
          </>
        )}

        <p className="login-foot">
          身份由 Autional 提供；密码以 SHA-256 哈希传输，本应用不存储明文密码。
        </p>
      </div>
    </div>
  );
}
