"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Autional,
  browserPlatform,
  processPasswordForTransmission,
  type User,
} from "@autional/core";
import { autionalConfig, AUTIONAL_TENANT_ID } from "@/lib/autional";
import { decideBoot } from "@/lib/auth-boot";
import { clearSession, readSession, writeSession } from "@/lib/session";
import {
  ensureToken,
  installTokenSession,
  type TokenIssue,
} from "@/lib/token-session";

interface AuthContextValue {
  autional: Autional;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** transient：网络/服务不可用；expired/revoked：需要重新登录；config：客户端配置问题 */
  authIssue: TokenIssue | null;
  retryAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const autional = useMemo(() => {
    const instance = new Autional({
      appId: autionalConfig.appId,
      issuer: autionalConfig.issuer,
      apiUrl: autionalConfig.apiUrl,
      tenantId: autionalConfig.tenantId,
      platform: browserPlatform,
      storagePrefix: autionalConfig.storagePrefix,
      syncTabs: autionalConfig.syncTabs,
    });
    installTokenSession(instance);
    return instance;
  }, []);

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authIssue, setAuthIssue] = useState<TokenIssue | null>(null);

  const boot = useCallback(
    async (alive: () => boolean) => {
      const ensured = await ensureToken(autional);
      const issue: TokenIssue | null = ensured.ok ? null : ensured.issue;

      try {
        await autional.initialize();
      } catch {
        /* initialize 内部已兜底 */
      }

      if (!alive()) return;

      const decision = decideBoot({
        authenticated: autional.isAuthenticated(),
        issue,
        hasSnapshot: readSession() !== null,
      });

      if (decision.kind === "authenticated") {
        writeSession(autional.user);
        setUser(autional.user);
        setAuthIssue(null);
        setIsLoading(false);
        return;
      }

      if (decision.kind === "keep-optimistic") {
        // 断网/服务异常：保留本地快照渲染的界面，让用户继续离线编辑，
        // 而不是把一次网络抖动当成「登录失效」踢回登录页。
        setAuthIssue(decision.issue);
        setIsLoading(false);
        return;
      }

      clearSession();
      setUser(null);
      setAuthIssue(decision.issue);
      setIsLoading(false);
    },
    [autional],
  );

  useEffect(() => {
    let alive = true;
    const isAlive = () => alive;

    // 首屏乐观恢复：本地有会话快照就先当已登录渲染工作区，
    // 真正的令牌校验放到后台进行——用户看到的等待从「认证 RTT」变成 0。
    const snapshot = readSession();
    if (snapshot) {
      setUser({ id: snapshot.id, email: snapshot.email });
      setIsLoading(false);
    }

    const sync = () => {
      if (!alive) return;
      setUser(autional.user);
      if (autional.isAuthenticated()) {
        writeSession(autional.user);
        setAuthIssue(null);
      }
    };

    const offUser = autional.on("USER_CHANGED", sync);
    const offToken = autional.on("TOKEN_CHANGED", sync);
    const offOut = autional.on("LOGGED_OUT", () => {
      if (!alive) return;
      clearSession();
      setUser(null);
      setAuthIssue("expired");
    });
    const offNone = autional.on("NOT_AUTHENTICATED", () => {
      if (!alive) return;
      // 没有快照 = 确实没有会话，直接清；有快照则交给 boot / 令牌请求去裁决，
      // 避免离线启动时把用户误踢回登录页。
      if (!readSession()) setUser(null);
      setAuthIssue("expired");
    });

    void boot(isAlive);

    return () => {
      alive = false;
      offUser();
      offToken();
      offOut();
      offNone();
    };
  }, [autional, boot]);

  const retryAuth = useCallback(async () => {
    setIsLoading(true);
    // 重试时若还有快照，先恢复界面再校验，避免整页回到转圈
    const snapshot = readSession();
    if (snapshot) {
      setUser({ id: snapshot.id, email: snapshot.email });
      setIsLoading(false);
    }
    await boot(() => true);
  }, [boot]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await autional.login({
        email,
        password,
        tenantId: AUTIONAL_TENANT_ID || undefined,
      });
      writeSession(result.user);
      setUser(result.user);
      setAuthIssue(null);
    },
    [autional],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      // SDK 0.4.1 的 register() 发送 tenantId；identity 服务要求 tenant_id。
      // 这里按同一套密码传输策略自行构造请求，随后走标准登录。
      const cfg = await autional.fetchAuthConfig(AUTIONAL_TENANT_ID);
      const policy = (cfg.passwordPolicy ?? {}) as {
        mode?: string;
        tenantId?: string;
        publicKey?: string;
      };
      const processed = await processPasswordForTransmission(password, {
        mode: (policy.mode as "plain" | "hash" | "symmetric" | "asymmetric") ?? "plain",
        tenantId: policy.tenantId ?? AUTIONAL_TENANT_ID,
        requireUpper: false,
        minLength: 0,
        publicKey: policy.publicKey ?? "",
      });
      await autional.api.post("/identity/api/v1/auth/register", {
        email,
        password: processed.password,
        password_transmission: processed.passwordTransmission,
        tenant_id: AUTIONAL_TENANT_ID,
      });
      await login(email, password);
    },
    [autional, login],
  );

  const logout = useCallback(async () => {
    try {
      await autional.logout();
    } finally {
      clearSession();
      setUser(null);
      setAuthIssue("expired");
    }
  }, [autional]);

  const value = useMemo<AuthContextValue>(
    () => ({
      autional,
      user,
      isLoading,
      isAuthenticated: !!user,
      authIssue,
      retryAuth,
      login,
      register,
      logout,
    }),
    [autional, user, isLoading, authIssue, retryAuth, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
