/**
 * 会话快照：只存「上次登录成功是谁」，用于首屏乐观渲染。
 *
 * 它不是凭证——真正的令牌由 SDK 存在自己的存储里，并且每次启动仍会被校验。
 * 失效时（过期 / 吊销 / 主动登出）这里会被清掉，界面随即回到登录页。
 */

const KEY = "marktext-web:session";

export interface SessionSnapshot {
  id: string;
  email?: string;
  /** 写入时间，便于将来做过期策略 */
  at: number;
}

export function readSession(): SessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { id, email, at } = parsed as Record<string, unknown>;
    if (typeof id !== "string" || !id) return null;
    return {
      id,
      email: typeof email === "string" ? email : undefined,
      at: typeof at === "number" ? at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeSession(user: { id?: string; email?: string } | null): void {
  if (typeof window === "undefined") return;
  if (!user?.id) {
    clearSession();
    return;
  }
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ id: user.id, email: user.email, at: Date.now() }),
    );
  } catch {
    /* 配额满也不影响功能，只是下次首屏回到等待态 */
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
