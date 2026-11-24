"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clearSession, readSession, writeSession } from "@/lib/session";

export interface AuthUser {
  id: string;
  email?: string;
}

export interface QrSession {
  sessionToken: string;
  numberMatching: string;
  expiresIn: number;
}

export interface QrStatus {
  status: string;
  superseded?: boolean;
  user?: { sub?: string; email?: string };
}

export type AuthIssue = "transient" | "expired" | "config";

interface SessionResponse {
  authenticated: boolean;
  error?: string;
  user?: {
    sub?: string;
    id?: string;
    email?: string | null;
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authIssue: AuthIssue | null;
  retryAuth: () => Promise<void>;
  refreshSession: () => Promise<AuthUser | null>;
  sendEmailCode: (email: string) => Promise<void>;
  loginWithEmailCode: (email: string, code: string) => Promise<AuthUser>;
  startQr: () => Promise<QrSession>;
  pollQr: (token: string) => Promise<QrStatus>;
  cancelQr: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ERROR_TEXT: Record<string, string> = {
  email_required: "请输入邮箱地址。",
  invalid_input: "请输入 6 位验证码。",
  send_failed: "验证码发送失败，请稍后重试。",
  login_failed: "验证码不正确或已过期，请重新获取。",
  mfa_required: "该账号需要额外验证，请先在 Autional 账户中心完成。",
  qr_initiate_failed: "二维码生成失败，请稍后重试。",
  qr_status_failed: "二维码状态读取失败，请稍后重试。",
  embed_not_configured: "登录服务尚未配置完成。",
};

function errorFrom(body: unknown, fallback: string): Error {
  const code =
    body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error ?? "")
      : "";
  return new Error(ERROR_TEXT[code] ?? fallback);
}

async function request<T>(
  path: string,
  init?: RequestInit,
  fallback = "操作失败，请稍后重试。",
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw errorFrom(data, fallback);
  return data as T;
}

function toUser(body: SessionResponse): AuthUser | null {
  if (!body.authenticated || !body.user) return null;
  const id = body.user.sub ?? body.user.id;
  if (typeof id !== "string" || !id) return null;
  return {
    id,
    email: typeof body.user.email === "string" ? body.user.email : undefined,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authIssue, setAuthIssue] = useState<AuthIssue | null>(null);
  const alive = useRef(true);

  const apply = useCallback((next: AuthUser | null) => {
    if (next) {
      writeSession(next);
      setUser(next);
      setAuthIssue(null);
    } else {
      clearSession();
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  const refreshSession = useCallback(async (): Promise<AuthUser | null> => {
    const body = await request<SessionResponse>(
      "/api/auth/session",
      undefined,
      "无法读取登录状态。",
    );
    const next = toUser(body);
    if (alive.current) apply(next);
    return next;
  }, [apply]);

  const boot = useCallback(async () => {
    const snapshot = readSession();
    if (snapshot) {
      setUser({ id: snapshot.id, email: snapshot.email });
      setIsLoading(false);
    }
    try {
      const next = await refreshSession();
      if (next) return;
      if (!alive.current) return;
      clearSession();
      setUser(null);
      setAuthIssue("expired");
      setIsLoading(false);
    } catch {
      if (!alive.current) return;
      // 网络/服务异常：保留本地快照继续离线编辑，不当作登出。
      setAuthIssue("transient");
      setIsLoading(false);
    }
  }, [refreshSession]);

  useEffect(() => {
    alive.current = true;
    void boot();
    return () => {
      alive.current = false;
    };
  }, [boot]);

  const retryAuth = useCallback(async () => {
    setIsLoading(true);
    await boot();
  }, [boot]);

  const sendEmailCode = useCallback(async (email: string) => {
    await request<{ ok: true }>(
      "/api/auth/embed/email/send",
      { method: "POST", body: JSON.stringify({ email }) },
      "验证码发送失败，请稍后重试。",
    );
  }, []);

  const loginWithEmailCode = useCallback(
    async (email: string, code: string): Promise<AuthUser> => {
      await request(
        "/api/auth/embed/email/login",
        { method: "POST", body: JSON.stringify({ email, code }) },
        "登录失败，请重新获取验证码。",
      );
      const next = await refreshSession();
      if (!next) throw new Error("登录状态未建立，请重试。");
      return next;
    },
    [refreshSession],
  );

  const startQr = useCallback(async (): Promise<QrSession> => {
    const data = await request<{
      sessionToken?: string;
      numberMatching?: string;
      expiresIn?: number;
    }>(
      "/api/auth/embed/qr/initiate",
      { method: "POST", body: "{}" },
      "二维码生成失败，请稍后重试。",
    );
    if (!data.sessionToken) throw new Error("二维码数据不完整，请重试。");
    return {
      sessionToken: data.sessionToken,
      numberMatching: data.numberMatching ?? "",
      expiresIn: data.expiresIn ?? 300,
    };
  }, []);

  const pollQr = useCallback(async (token: string): Promise<QrStatus> => {
    const data = await request<QrStatus>(
      `/api/auth/embed/qr/status?token=${encodeURIComponent(token)}`,
      { method: "GET" },
      "二维码状态读取失败。",
    );
    return data;
  }, []);

  const cancelQr = useCallback(async (token: string): Promise<void> => {
    await request(
      "/api/auth/embed/qr/revoke",
      { method: "POST", body: JSON.stringify({ token }) },
      "取消失败。",
    ).catch(() => undefined);
  }, []);

  const logout = useCallback(async () => {
    try {
      await request("/api/auth/logout", { method: "POST", body: "{}" });
    } finally {
      clearSession();
      setUser(null);
      setAuthIssue("expired");
      setIsLoading(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      authIssue,
      retryAuth,
      refreshSession,
      sendEmailCode,
      loginWithEmailCode,
      startQr,
      pollQr,
      cancelQr,
      logout,
    }),
    [
      user,
      isLoading,
      authIssue,
      retryAuth,
      refreshSession,
      sendEmailCode,
      loginWithEmailCode,
      startQr,
      pollQr,
      cancelQr,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

