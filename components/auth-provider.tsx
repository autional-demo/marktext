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

interface AuthContextValue {
  autional: Autional;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const autional = useMemo(
    () =>
      new Autional({
        appId: autionalConfig.appId,
        issuer: autionalConfig.issuer,
        apiUrl: autionalConfig.apiUrl,
        tenantId: autionalConfig.tenantId,
        platform: browserPlatform,
        storagePrefix: autionalConfig.storagePrefix,
        syncTabs: autionalConfig.syncTabs,
      }),
    [],
  );

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (alive) setUser(autional.user);
    };

    const offUser = autional.on("USER_CHANGED", sync);
    const offToken = autional.on("TOKEN_CHANGED", sync);
    const offOut = autional.on("LOGGED_OUT", () => {
      if (alive) setUser(null);
    });
    const offNone = autional.on("NOT_AUTHENTICATED", () => {
      if (alive) setUser(null);
    });

    autional
      .initialize()
      .catch(() => undefined)
      .finally(() => {
        if (alive) {
          setUser(autional.user);
          setIsLoading(false);
        }
      });

    return () => {
      alive = false;
      offUser();
      offToken();
      offOut();
      offNone();
    };
  }, [autional]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await autional.login({
        email,
        password,
        tenantId: AUTIONAL_TENANT_ID || undefined,
      });
      setUser(result.user);
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
      setUser(null);
    }
  }, [autional]);

  const value = useMemo<AuthContextValue>(
    () => ({
      autional,
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
    }),
    [autional, user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
