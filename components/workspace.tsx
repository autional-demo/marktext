"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "./editor";
import { useAuth } from "./auth-provider";
import {
  Doc,
  WELCOME_DOC,
  loadDocs,
  newDoc,
  rememberUser,
  saveDocs,
} from "@/lib/docs";
import {
  ApiError,
  createDoc,
  getDoc,
  listDocs,
  removeDoc,
  saveDoc,
} from "@/lib/docs-api";
import { docPath } from "@/lib/nav";
import { ensureToken } from "@/lib/token-session";

const SAVE_DELAY = 1200;
const CACHE_DELAY = 500;

type SaveStatus = "idle" | "saving" | "saved" | "offline" | "conflict";

interface Conflict {
  id: string;
  server: { id: string; title: string; content: string; rev: number; updatedAt: string };
}

interface WorkspaceProps {
  userId: string;
  initialDocId?: string;
}

function toMillis(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export default function Workspace({ userId, initialDocId }: WorkspaceProps) {
  const { user, logout, autional } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [everSynced, setEverSynced] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [sessionIssue, setSessionIssue] = useState<"expired" | "revoked" | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);

  const docsRef = useRef<Doc[]>([]);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * 取 token：统一走 token-session（跨标签锁 + 错误分类）。
   * - transient/config：只标记离线，不清会话；
   * - expired/revoked：才显示重新登录横幅。
   */
  const getToken = useCallback(
    async (force = false): Promise<string | null> => {
      const result = await ensureToken(autional, { force });
      if (result.ok) {
        setSessionIssue(null);
        return result.token;
      }
      if (result.issue === "expired" || result.issue === "revoked") {
        setSessionIssue(result.issue);
      } else {
        setStatus("offline");
      }
      return null;
    },
    [autional],
  );

  /* 主动刷新：只在可见且临近过期时触发，避免增加轮换次数 */
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      if (!autional.isAuthenticated()) return;
      if (autional.tokenManager.needsRefresh(60_000)) {
        void ensureToken(autional);
      }
    };
    const timer = setInterval(check, 60_000);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [autional]);

  const scheduleCache = useCallback(() => {
    if (cacheTimer.current) clearTimeout(cacheTimer.current);
    cacheTimer.current = setTimeout(() => {
      cacheTimer.current = null;
      saveDocs(userId, docsRef.current);
    }, CACHE_DELAY);
  }, [userId]);

  const applyDocs = useCallback(
    (next: Doc[]) => {
      docsRef.current = next;
      setDocs(next);
      scheduleCache();
    },
    [scheduleCache],
  );

  const updateDoc = useCallback(
    (id: string, patch: Partial<Doc>) => {
      applyDocs(
        docsRef.current.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      );
    },
    [applyDocs],
  );

  /* ---------------- 保存 ---------------- */

  const flushSave = useCallback(
    async (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc || doc.loaded === false) return;

      let token = await getToken();
      if (!token) {
        setStatus("offline");
        return;
      }

      setStatus("saving");
      const payload = { title: doc.title, content: doc.content, rev: doc.rev };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const saved = await saveDoc(token, id, payload);
          updateDoc(id, {
            rev: saved.rev,
            updatedAt: toMillis(saved.updatedAt),
          });
          setSavedAt(Date.now());
          setStatus("saved");
          return;
        } catch (err) {
          if (err instanceof ApiError) {
            if (err.status === 409) {
              const server = (err.body as { doc?: Conflict["server"] } | undefined)?.doc;
              if (server) {
                setConflict({ id, server });
                setStatus("conflict");
                return;
              }
            }
            if (err.status === 404) {
              // 本机新建但服务端还没有：补一次创建
              try {
                const created = await createDoc(token, {
                  id,
                  title: doc.title,
                  content: doc.content,
                });
                updateDoc(id, {
                  rev: created.rev,
                  updatedAt: toMillis(created.updatedAt),
                });
                setSavedAt(Date.now());
                setStatus("saved");
                return;
              } catch {
                /* fallthrough */
              }
            }
            if (err.status === 401 && attempt === 0) {
              // access token 只有 5 分钟：强制刷新后重试一次
              const fresh = await getToken(true);
              if (fresh) {
                token = fresh;
                continue;
              }
            }
          }
          setStatus("offline");
          return;
        }
      }
    },
    [getToken, updateDoc],
  );

  const queueSave = useCallback(
    (id: string) => {
      const prev = saveTimers.current.get(id);
      if (prev) clearTimeout(prev);
      saveTimers.current.set(
        id,
        setTimeout(() => {
          saveTimers.current.delete(id);
          void flushSave(id);
        }, SAVE_DELAY),
      );
    },
    [flushSave],
  );

  const flushAll = useCallback(() => {
    for (const [id, timer] of saveTimers.current) {
      clearTimeout(timer);
      void flushSave(id);
    }
    saveTimers.current.clear();
  }, [flushSave]);

  /* ---------------- 初始加载与同步 ---------------- */

  useEffect(() => {
    let alive = true;
    rememberUser(userId);

    const cached = loadDocs(userId);
    docsRef.current = cached;
    setDocs(cached);
    setActiveId(() => {
      if (initialDocId && cached.some((d) => d.id === initialDocId)) return initialDocId;
      return cached[0]?.id ?? null;
    });
    setReady(true);

    void (async () => {
      const token = await getToken();
      if (!alive) return;
      if (!token) {
        setStatus("offline");
        return;
      }

      let server;
      try {
        server = await listDocs(token);
      } catch {
        if (alive) setStatus("offline");
        return;
      }
      if (!alive) return;

      const localById = new Map(docsRef.current.map((d) => [d.id, d]));
      const serverIds = new Set(server.map((d) => d.id));

      // 1) 本机有、云端没有的 → 上传（只传从未同步过的 rev=0 文档）
      //    rev > 0 却不在云端，说明在别的设备被删除，不能复活。
      const uploaded = new Map<string, Doc>();
      for (const local of docsRef.current) {
        if (serverIds.has(local.id) || local.rev > 0) continue;
        try {
          const created = await createDoc(token, {
            id: local.id,
            title: local.title,
            content: local.content,
          });
          uploaded.set(local.id, {
            ...local,
            rev: created.rev,
            updatedAt: toMillis(created.updatedAt),
          });
        } catch {
          /* 冲突或离线：保留本机版本，后续保存时会重试 */
        }
      }
      if (!alive) return;

      // 2) 合并：rev 相同才复用本地正文，否则标记待拉取
      const merged: Doc[] = server.map((meta) => {
        const local = localById.get(meta.id);
        const sameRev = !!local && local.rev === meta.rev && local.loaded !== false;
        return {
          id: meta.id,
          title: meta.title,
          content: sameRev ? local!.content : "",
          rev: meta.rev,
          updatedAt: toMillis(meta.updatedAt),
          loaded: sameRev,
        };
      });

      // 3) 上传成功但列表里还没有的（首次上传）
      for (const [, doc] of uploaded) {
        if (!merged.some((d) => d.id === doc.id)) merged.unshift(doc);
      }

      // 4) 上传失败的本机文档保留在界面上，下次保存再重试
      for (const local of docsRef.current) {
        if (local.rev > 0) continue;
        if (merged.some((d) => d.id === local.id)) continue;
        merged.unshift(local);
      }

      // 5) 全新账号：造一篇欢迎文档
      if (merged.length === 0) {
        const welcome = newDoc("欢迎使用 MarkText Web", WELCOME_DOC);
        merged.push(welcome);
        try {
          const created = await createDoc(token, {
            id: welcome.id,
            title: welcome.title,
            content: welcome.content,
          });
          welcome.rev = created.rev;
          welcome.updatedAt = toMillis(created.updatedAt);
        } catch {
          /* 离线也无所谓，保存时会补建 */
        }
      }

      if (!alive) return;
      applyDocs(merged);
      setActiveId((prev) => {
        if (initialDocId && merged.some((d) => d.id === initialDocId)) return initialDocId;
        if (prev && merged.some((d) => d.id === prev)) return prev;
        return merged[0]?.id ?? null;
      });
      setStatus("idle");
      setEverSynced(true);
    })();

    return () => {
      alive = false;
    };
    // 只在切换账号时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* ---------------- 按需拉取正文 ---------------- */

  useEffect(() => {
    if (!activeId) return;
    const doc = docsRef.current.find((d) => d.id === activeId);
    if (!doc || doc.loaded !== false) return;

    let alive = true;
    void (async () => {
      const token = await getToken();
      if (!token) {
        setStatus("offline");
        return;
      }
      try {
        const full = await getDoc(token, activeId);
        if (!alive) return;
        updateDoc(activeId, {
          title: full.title,
          content: full.content,
          rev: full.rev,
          updatedAt: toMillis(full.updatedAt),
          loaded: true,
        });
      } catch {
        if (alive) setStatus("offline");
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeId, docs, getToken, updateDoc]);

  /* ---------------- 离开页面前尽量落盘 ---------------- */

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    window.addEventListener("beforeunload", flushAll);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flushAll);
      document.removeEventListener("visibilitychange", onHide);
      flushAll();
      if (cacheTimer.current) clearTimeout(cacheTimer.current);
      saveDocs(userId, docsRef.current);
    };
  }, [flushAll, userId]);

  /* ---------------- URL 与浏览器历史 ---------------- */

  // 当前文档变化时同步地址栏；用 replaceState 避免污染历史
  useEffect(() => {
    if (!ready) return;
    const target = activeId ? docPath(activeId) : "/";
    if (window.location.pathname !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [activeId, ready]);

  // 浏览器前进/后退
  useEffect(() => {
    const onPop = () => {
      const match = /^\/d\/([^/]+)\/?$/.exec(window.location.pathname);
      let id: string | null = null;
      if (match) {
        try {
          id = decodeURIComponent(match[1]);
        } catch {
          id = null;
        }
      }
      setActiveId(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const selectDoc = useCallback((id: string) => {
    setActiveId(id);
    window.history.pushState(null, "", docPath(id));
  }, []);

  /* ---------------- 操作 ---------------- */

  const active = useMemo(
    () => docs.find((d) => d.id === activeId) ?? null,
    [docs, activeId],
  );

  const handleChange = useCallback(
    (id: string, markdown: string) => {
      updateDoc(id, { content: markdown, updatedAt: Date.now() });
      setSavedAt(null);
      queueSave(id);
    },
    [updateDoc, queueSave],
  );

  const addDoc = useCallback(() => {
    const doc = newDoc();
    applyDocs([doc, ...docsRef.current]);
    selectDoc(doc.id);
    setConflict(null);

    void (async () => {
      const token = await getToken();
      if (!token) {
        setStatus("offline");
        return;
      }
      try {
        const created = await createDoc(token, {
          id: doc.id,
          title: doc.title,
          content: doc.content,
        });
        updateDoc(doc.id, {
          rev: created.rev,
          updatedAt: toMillis(created.updatedAt),
        });
        setStatus("saved");
      } catch {
        setStatus("offline");
      }
    })();
  }, [applyDocs, getToken, selectDoc, updateDoc]);

  const deleteDoc = useCallback(
    (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc) return;
      if (
        !window.confirm(`删除文档「${doc.title || "未命名文档"}」？此操作不可撤销。`)
      ) {
        return;
      }

      const timer = saveTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        saveTimers.current.delete(id);
      }

      void (async () => {
        const token = await getToken();
        if (token) {
          try {
            await removeDoc(token, id);
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 404)) {
              window.alert("删除失败，请检查网络后重试。");
              return;
            }
          }
        }
        const next = docsRef.current.filter((d) => d.id !== id);
        applyDocs(next);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
      })();
    },
    [activeId, applyDocs, getToken],
  );

  const renameDoc = useCallback(
    (title: string) => {
      if (!activeId) return;
      updateDoc(activeId, { title, updatedAt: Date.now() });
      setSavedAt(null);
      queueSave(activeId);
    },
    [activeId, updateDoc, queueSave],
  );

  const importDoc = useCallback(
    (file: File) => {
      void (async () => {
        const text = await file.text();
        const doc = newDoc(file.name.replace(/\.(md|markdown|txt)$/i, ""), text);
        applyDocs([doc, ...docsRef.current]);
        selectDoc(doc.id);

        const token = await getToken();
        if (!token) {
          setStatus("offline");
          return;
        }
        try {
          const created = await createDoc(token, {
            id: doc.id,
            title: doc.title,
            content: doc.content,
          });
          updateDoc(doc.id, {
            rev: created.rev,
            updatedAt: toMillis(created.updatedAt),
          });
          setStatus("saved");
        } catch {
          setStatus("offline");
        }
      })();
    },
    [applyDocs, getToken, selectDoc, updateDoc],
  );

  const exportDoc = useCallback(() => {
    if (!active) return;
    setExporting(true);
    try {
      const blob = new Blob([active.content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(active.title || "untitled").replace(/[\\/:*?"<>|]/g, "-")}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [active]);

  const loadServerVersion = useCallback(() => {
    if (!conflict) return;
    const server = conflict.server;
    updateDoc(server.id, {
      title: server.title,
      content: server.content,
      rev: server.rev,
      updatedAt: toMillis(server.updatedAt),
      loaded: true,
    });
    setEditorEpoch((n) => n + 1);
    setConflict(null);
    setSavedAt(Date.now());
    setStatus("saved");
  }, [conflict, updateDoc]);

  const overwriteServer = useCallback(() => {
    if (!conflict) return;
    const doc = docsRef.current.find((d) => d.id === conflict.id);
    if (!doc) return;

    void (async () => {
      const token = await getToken();
      if (!token) {
        setStatus("offline");
        return;
      }
      try {
        const saved = await saveDoc(token, conflict.id, {
          title: doc.title,
          content: doc.content,
        });
        updateDoc(conflict.id, {
          rev: saved.rev,
          updatedAt: toMillis(saved.updatedAt),
        });
        setConflict(null);
        setSavedAt(Date.now());
        setStatus("saved");
      } catch {
        setStatus("offline");
      }
    })();
  }, [conflict, getToken, updateDoc]);

  const handleLogout = useCallback(async () => {
    flushAll();
    saveDocs(userId, docsRef.current);
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }, [flushAll, logout, userId]);

  const relogin = useCallback(async () => {
    flushAll();
    saveDocs(userId, docsRef.current);
    try {
      await autional.logout();
    } catch {
      /* 令牌已失效时 logout 也可能失败，忽略 */
    } finally {
      window.location.assign("/login");
    }
  }, [autional, flushAll, userId]);

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-logo">M↓</div>
        <p>正在加载文档…</p>
      </div>
    );
  }

  const timeLabel = savedAt
    ? new Date(savedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const statusText =
    status === "conflict"
      ? "版本冲突"
      : status === "saving"
        ? "保存中…"
        : status === "offline"
          ? "仅本机 · 未同步"
          : status === "saved"
            ? timeLabel
              ? `已同步到云端 · ${timeLabel}`
              : "已同步到云端"
            : everSynced
              ? "已同步到云端"
              : "仅本机";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">M↓</span>
          <span className="brand-name">MarkText</span>
          <span className="brand-badge">Web</span>
        </div>

        <button className="new-doc" onClick={addDoc}>
          ＋ 新建文档
        </button>

        <nav className="doc-list" aria-label="文档列表">
          {docs.length === 0 && <p className="empty-hint">还没有文档</p>}
          {docs.map((d) => (
            <div
              key={d.id}
              className={`doc-item ${d.id === activeId ? "active" : ""}`}
              onClick={() => selectDoc(d.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") selectDoc(d.id);
              }}
            >
              <span className="doc-title">{d.title || "未命名文档"}</span>
              <button
                className="doc-delete"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteDoc(d.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </nav>

        <div className="account">
          <div className="account-avatar">
            {(user?.email ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="account-meta">
            <span className="account-email" title={user?.email}>
              {user?.email ?? userId}
            </span>
            <span className="account-hint">Autional 账号</span>
          </div>
          <button className="logout" onClick={handleLogout} title="登出">
            登出
          </button>
        </div>
      </aside>

      <main className="main">
        {active ? (
          <>
            <header className="toolbar">
              <input
                className="title-input"
                value={active.title}
                placeholder="文档标题"
                onChange={(e) => renameDoc(e.target.value)}
              />
              <div className="toolbar-actions">
                <span
                  className={`save-state ${status}`}
                  title="本机缓存即时写入；云端按 1.2 秒防抖同步"
                >
                  {statusText}
                </span>
                <button onClick={() => fileRef.current?.click()} disabled={exporting}>
                  导入
                </button>
                <button onClick={exportDoc} disabled={exporting}>
                  导出 .md
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importDoc(file);
                  e.target.value = "";
                }}
              />
            </header>

            {sessionIssue && (
              <div className="session-bar">
                <span>
                  {sessionIssue === "revoked"
                    ? "会话已在其他设备退出，改动已保存在本机。"
                    : "登录已过期，改动已保存在本机。"}
                </span>
                <button onClick={relogin}>重新登录</button>
              </div>
            )}

            {conflict && conflict.id === active.id && (
              <div className="conflict-bar">
                <span>这篇文档在其它设备被修改过。</span>
                <button onClick={loadServerVersion}>载入云端版本</button>
                <button onClick={overwriteServer}>用本机覆盖</button>
              </div>
            )}

            <div className="editor-shell">
              {active.loaded === false ? (
                <div className="editor-loading">正在加载文档…</div>
              ) : (
                <Editor
                  key={`${active.id}:${editorEpoch}`}
                  docId={active.id}
                  initialContent={active.content}
                  onChange={handleChange}
                />
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h1>MarkText Web</h1>
            <p>新建文档开始写作，或导入一份 Markdown。</p>
            <button className="primary" onClick={addDoc}>
              新建文档
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
