"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registerUrl, useAuth, type QrSession } from "@/components/auth-provider";
import { safeNext } from "@/lib/nav";
import { Spinner } from "@/components/loading";

type Tab = "qr" | "email";
type QrPhase = "idle" | "loading" | "pending" | "scanned" | "error" | "expired";

const AUTHENTICATOR_APPROVE = "https://authenticator.autional.cn/login-approve";

function qrUrl(session: QrSession): string {
  const params = new URLSearchParams({
    token: session.sessionToken,
    nm: session.numberMatching,
  });
  return `${AUTHENTICATOR_APPROVE}?${params.toString()}`;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function LoginPage() {
  const {
    isLoading,
    isAuthenticated,
    refreshSession,
    sendEmailCode,
    loginWithEmailCode,
    startQr,
    pollQr,
    cancelQr,
  } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("qr");
  const [error, setError] = useState<string | null>(null);

  const [qrPhase, setQrPhase] = useState<QrPhase>("idle");
  const [qrSession, setQrSession] = useState<QrSession | null>(null);
  const [qrSrc, setQrSrc] = useState("");
  const [qrSeconds, setQrSeconds] = useState(300);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const pollTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(safeNext());
  }, [isLoading, isAuthenticated, router]);

  const stopTimers = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (tickTimer.current !== null) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const finish = useCallback(async () => {
    const user = await refreshSession();
    if (!user) throw new Error("登录状态未建立，请重试。");
    stopTimers();
    router.replace(safeNext());
  }, [refreshSession, router, stopTimers]);

  const beginQr = useCallback(async () => {
    stopTimers();
    setQrPhase("loading");
    setError(null);
    setQrSrc("");
    setQrSession(null);
    try {
      const session = await startQr();
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(qrUrl(session), {
        width: 240,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#101418", light: "#ffffff" },
      });
      setQrSession(session);
      setQrSrc(dataUrl);
      setQrSeconds(session.expiresIn || 300);
      setQrPhase("pending");

      pollTimer.current = window.setInterval(() => {
        void (async () => {
          try {
            const status = await pollQr(session.sessionToken);
            if (status.status === "scanned") {
              setQrPhase("scanned");
              return;
            }
            if (status.status === "expired" || status.status === "cancelled") {
              stopTimers();
              setQrPhase("expired");
              return;
            }
            if (status.status === "confirmed") {
              stopTimers();
              await finish();
            }
          } catch {
            /* transient: keep polling until the countdown ends */
          }
        })();
      }, 2000);

      tickTimer.current = window.setInterval(() => {
        setQrSeconds((value) => {
          if (value <= 1) {
            stopTimers();
            setQrPhase((phase) =>
              phase === "pending" || phase === "scanned" ? "expired" : phase,
            );
            return 0;
          }
          return value - 1;
        });
      }, 1000);
    } catch (err) {
      setQrPhase("error");
      setError(err instanceof Error ? err.message : "二维码生成失败。");
    }
  }, [finish, pollQr, startQr, stopTimers]);

  const cancelQrLogin = useCallback(() => {
    if (qrSession) void cancelQr(qrSession.sessionToken);
    stopTimers();
    setQrSession(null);
    setQrSrc("");
    setQrPhase("idle");
    setQrSeconds(300);
  }, [cancelQr, qrSession, stopTimers]);

  const sendCode = useCallback(async () => {
    if (sending || cooldown > 0) return;
    const address = email.trim();
    if (!address) {
      setError("请输入邮箱地址。");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendEmailCode(address);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败。");
    } finally {
      setSending(false);
    }
  }, [cooldown, email, sendEmailCode, sending]);

  const submitEmail = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;
      const address = email.trim();
      if (!address) {
        setError("请输入邮箱地址。");
        return;
      }
      if (!/^\d{6}$/.test(code.trim())) {
        setError("请输入 6 位验证码。");
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        await loginWithEmailCode(address, code.trim());
        router.replace(safeNext());
      } catch (err) {
        setError(err instanceof Error ? err.message : "登录失败，请重试。");
        setSubmitting(false);
      }
    },
    [code, email, loginWithEmailCode, router, submitting],
  );

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

        <div className="mode-tabs" role="tablist" aria-label="选择登录方式">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "qr"}
            className={tab === "qr" ? "active" : ""}
            onClick={() => {
              setTab("qr");
              setError(null);
            }}
          >
            扫码登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "email"}
            className={tab === "email" ? "active" : ""}
            onClick={() => {
              setTab("email");
              setError(null);
              cancelQrLogin();
            }}
          >
            邮箱验证码
          </button>
        </div>

        {tab === "qr" && (
          <div className="qr-panel">
            {qrPhase === "idle" && (
              <>
                <p className="qr-hint">
                  用手机上的 Autional 认证器扫码，核对 6 位数字后确认。
                </p>
                <button
                  type="button"
                  className="sso-button"
                  onClick={() => void beginQr()}
                >
                  获取二维码
                </button>
              </>
            )}

            {qrPhase === "loading" && (
              <p className="qr-loading" role="status">
                <Spinner size={13} /> 正在生成二维码…
              </p>
            )}

            {(qrPhase === "pending" || qrPhase === "scanned") && qrSrc && (
              <>
                <div className="qr-box">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrSrc} alt="登录二维码" width={220} height={220} />
                  <p className="qr-clock">二维码 {clock(qrSeconds)} 后过期</p>
                </div>
                {qrSession?.numberMatching && (
                  <div className="qr-match" aria-label="手机与桌面应显示同一数字">
                    <span>手机与桌面应显示同一数字</span>
                    <strong>{qrSession.numberMatching}</strong>
                  </div>
                )}
                <p className="qr-steps">
                  {qrPhase === "scanned"
                    ? "已扫码。请在手机上核对数字并点确认。"
                    : "① 打开认证器 ② 扫描二维码 ③ 核对数字 ④ 点确认"}
                </p>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={cancelQrLogin}
                >
                  取消
                </button>
              </>
            )}

            {qrPhase === "expired" && (
              <div className="qr-retry">
                <p>二维码已过期。</p>
                <button
                  type="button"
                  className="sso-button"
                  onClick={() => void beginQr()}
                >
                  重新获取
                </button>
              </div>
            )}

            {qrPhase === "error" && (
              <div className="qr-retry">
                <p>二维码生成失败。</p>
                <button
                  type="button"
                  className="sso-button"
                  onClick={() => void beginQr()}
                >
                  重试
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "email" && (
          <form className="auth-form" onSubmit={submitEmail}>
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
              验证码
              <div className="code-row">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="6 位数字"
                />
                <button
                  type="button"
                  className="ghost-button code-send"
                  disabled={sending || cooldown > 0}
                  onClick={() => void sendCode()}
                >
                  {sending ? "发送中…" : cooldown > 0 ? `${cooldown}s 后重发` : "发送验证码"}
                </button>
              </div>
            </label>
            <button type="submit" className="sso-button" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner size={13} /> 正在登录…
                </>
              ) : (
                "登录 MarkText Web"
              )}
            </button>
          </form>
        )}

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <p className="login-foot">
          登录页不收集密码。账号注册与安全管理在{" "}
          <a href={registerUrl()} rel="noreferrer">
            Autional
          </a>{" "}
          完成。
        </p>
      </div>
    </div>
  );
}
