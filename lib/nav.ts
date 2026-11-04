export const NEXT_KEY = "marktext:next";

function safePath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/** 登录页读 ?next=，只允许站内相对路径。 */
export function safeNext(): string {
  if (typeof window === "undefined") return "/";
  return safePath(new URLSearchParams(window.location.search).get("next"));
}

/** SSO 整页跳转前存下目标，回调页取回。 */
export function rememberNext(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(NEXT_KEY, safeNext());
}

export function takeNext(): string {
  if (typeof window === "undefined") return "/";
  const stored = window.sessionStorage.getItem(NEXT_KEY);
  window.sessionStorage.removeItem(NEXT_KEY);
  return safePath(stored);
}

export function docPath(id: string): string {
  return `/d/${encodeURIComponent(id)}`;
}
