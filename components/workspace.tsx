"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import DocList from "./doc-list";
import { DocListSkeleton, EditorSkeleton, Spinner, Splash } from "./loading";
import {
  Doc,
  WELCOME_DOC,
  hashText,
  loadDocs,
  newDoc,
  readLastDocId,
  rememberUser,
  saveDocs,
  writeLastDocId,
} from "@/lib/docs";
import { mergeDocs } from "@/lib/merge";
import {
  ApiError,
  createDoc,
  getDoc,
  listDocs,
  patchDoc,
  removeDoc,
  saveDoc,
} from "@/lib/docs-api";
import { docPath } from "@/lib/nav";

/**
 * 编辑器（含 muya 内核）是包里最重的一块，异步加载：
 * 侧栏与文档元数据先渲染，内核下载期间显示骨架屏。
 * muya 的样式跟着这个 chunk 走，不再进首屏 CSS。
 */
const Editor = dynamic(() => import("./editor"), {
  ssr: false,
  loading: () => <EditorSkeleton label="正在准备编辑器…" />,
});

const SAVE_DELAY = 1200;
const CACHE_DELAY = 500;
/** 首屏并行预热的正文数量：手机上别一次拉太多。 */
const IDLE_PREFETCH_LIMIT = 2;
/** 后台检查更新的间隔（可见时才跑），带随机抖动避免多标签同拍。 */
const SYNC_INTERVAL_MS = 60_000;
const SYNC_JITTER_MS = 15_000;
/** 每轮静默拉取云端新版的篇数上限，避免一次打满带宽。 */
const STALE_SYNC_LIMIT = 3;

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
  const { user, logout } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [everSynced, setEverSynced] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [sessionIssue, setSessionIssue] = useState<"expired" | "revoked" | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [exporting, setExporting] = useState(false);
  /** 转瞬即逝的提示（例如「已载入云端新版」），不打断操作 */
  const [notice, setNotice] = useState<string | null>(null);

  const docsRef = useRef<Doc[]>([]);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 正在拉取的正文 id，避免 hover 预取与切文档重复请求 */
  const inflightContent = useRef(new Set<string>());
  /** 当前文档 id（避免 selectDoc 依赖 activeId 而频繁变身份） */
  const activeIdRef = useRef<string | null>(null);
  /** 编辑器是否有焦点：有焦点时不静默替换正文，免得光标乱跳 */
  const editorFocused = useRef(false);
  /** 同一时刻只跑一次后台同步 */
  const syncInFlight = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 顶部/底部闪一条提示，4 秒后自动消失（不弹窗、不阻塞）。 */
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);
  const idlePrefetched = useRef(false);
  const handledNewParam = useRef(false);
  /** 编辑器内核是否已预热（只触发一次） */
  const warmed = useRef(false);

  /**
   * 会话凭证由 HttpOnly Cookie 自动携带，这里只保留调用点签名。
   * 返回空串表示「不带 Authorization 头」。
   */
  const getToken = useCallback(
    async (_force = false): Promise<string | null> => {
      void _force;
      // 非空哨兵：调用点用 `if (!token)` 判空；docs-api 见 "cookie" 不带 Bearer 头。
      return "cookie";
    },
    [],
  );

  const scheduleCache = useCallback(() => {
    if (cacheTimer.current) clearTimeout(cacheTimer.current);
    cacheTimer.current = setTimeout(() => {
      cacheTimer.current = null;
      void saveDocs(userId, docsRef.current);
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

      // 增量同步：只上传相对「云端已知版本」真正变了的字段。
      // 只改标题时不再把整篇正文重新加密上传（长文档最明显）。
      const titleHash = hashText(doc.title);
      const contentHash = hashText(doc.content);
      const titleChanged = doc.synced?.title !== titleHash;
      const contentChanged = doc.synced?.content !== contentHash;
      if (!titleChanged && !contentChanged) return;

      let token = await getToken();
      if (!token) {
        setStatus("offline");
        return;
      }

      setStatus("saving");
      const payload: { title?: string; content?: string; rev: number } = { rev: doc.rev };
      if (titleChanged) payload.title = doc.title;
      if (contentChanged) payload.content = doc.content;
      const synced = { title: titleHash, content: contentHash };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const saved = await patchDoc(token, id, payload);
          updateDoc(id, {
            rev: saved.rev,
            updatedAt: toMillis(saved.updatedAt),
            synced,
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
                  synced,
                });
                setSavedAt(Date.now());
                setStatus("saved");
                return;
              } catch {
                /* fallthrough */
              }
            }
            if (err.status === 401) {
              // 会话 Cookie 失效或被撤销：提示重新登录，不再自动续期。
              setSessionIssue("expired");
              setStatus("offline");
              return;
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

  /* ---------------- 按需拉取正文 ---------------- */

  /* 预热编辑器内核：与列表请求并行，省掉「文档到了才开始下载 muya」的串行等待 */
  useEffect(() => {
    if (warmed.current) return;
    warmed.current = true;

    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    // 省流量 / 弱网时不做预热，把带宽留给正文
    if (conn?.saveData) return;
    if (conn?.effectiveType && /^(slow-2g|2g)$/i.test(conn.effectiveType)) return;

    const start = () => {
      void import("@muyajs/core").catch(() => {
        /* 预热失败不影响正常加载路径 */
      });
    };
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") ric(start, { timeout: 2500 });
    else window.setTimeout(start, 600);
  }, []);

  /**
   * 真正去拉正文（不做「要不要拉」的判断）。
   * 同一个 id 并发去重：切文档、hover 预取、空闲预热可能同时想要同一篇。
   */
  const fetchContent = useCallback(
    async (id: string): Promise<boolean> => {
      if (inflightContent.current.has(id)) return false;
      inflightContent.current.add(id);

      try {
        const token = await getToken();
        if (!token) {
          setStatus("offline");
          return false;
        }
        const full = await getDoc(token, id);
        updateDoc(id, {
          title: full.title,
          content: full.content,
          rev: full.rev,
          updatedAt: toMillis(full.updatedAt),
          loaded: true,
          // 已经拿到云端最新版：清掉「有新版本」标记
          remoteRev: undefined,
          remoteTitle: undefined,
          remoteConflict: undefined,
          synced: {
            title: hashText(full.title),
            content: hashText(full.content),
          },
        });
        return true;
      } catch {
        setStatus("offline");
        return false;
      } finally {
        inflightContent.current.delete(id);
      }
    },
    [getToken, updateDoc],
  );

  /** 本地还没正文的文档：按需拉取（切文档 / hover / 空闲预热共用）。 */
  const ensureContent = useCallback(
    (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc || doc.loaded !== false) return;
      void fetchContent(id);
    },
    [fetchContent],
  );

  /**
   * 云端有新版时重新载入这一篇：先切成骨架屏，再拉正文，
   * 这样编辑器会用新内容重新挂载，而不是带着旧正文继续编辑。
   */
  const refreshFromRemote = useCallback(
    async (id: string): Promise<boolean> => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc || !doc.remoteRev) return false;
      updateDoc(id, { loaded: false });
      const ok = await fetchContent(id);
      // 拉取失败（断网/401）：恢复本机正文，别让用户停在骨架屏上
      if (!ok) {
        const current = docsRef.current.find((d) => d.id === id);
        if (current && current.loaded === false) updateDoc(id, { loaded: true });
      }
      return ok;
    },
    [fetchContent, updateDoc],
  );

  // 切到某篇时立刻补正文
  useEffect(() => {
    if (!activeId) return;
    ensureContent(activeId);
  }, [activeId, docs, ensureContent]);

  /** 切到某篇时：如果它带着「云端有新版本」的标记，就直接换成云端正文（真冲突除外）。 */
  const maybeRefreshRemote = useCallback(
    (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (doc?.remoteRev && !doc.remoteConflict) void refreshFromRemote(id);
    },
    [refreshFromRemote],
  );

  // 首屏稳定后闲时预热前几篇，切文档时就不用再等网络
  useEffect(() => {
    if (syncing || !ready || idlePrefetched.current) return;
    idlePrefetched.current = true;

    const targets = docsRef.current
      .filter((d) => d.loaded === false)
      .slice(0, IDLE_PREFETCH_LIMIT);
    if (targets.length === 0) return;

    const start = () => {
      for (const doc of targets) ensureContent(doc.id);
    };
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") ric(start, { timeout: 3000 });
    else window.setTimeout(start, 800);
  }, [syncing, ready, ensureContent]);

  /* ---------------- 后台同步：远端只是备胎 ---------------- */

  /**
   * 静默刷新「云端有新版、本地干净」的文档。
   * 不提示、不打断：当前文档只有在编辑器没有焦点时才替换（免得光标乱跳），
   * 其余文档直接拉下来写进本机缓存，下次打开就是新的。
   */
  const syncStaleDocs = useCallback(async () => {
    const candidates = docsRef.current.filter(
      (doc) => doc.remoteRev && !doc.remoteConflict,
    );
    if (candidates.length === 0) return;

    // 当前文档优先；用户正在看/编辑它时先跳过，等失焦再补
    const ordered = [...candidates].sort((a, b) => {
      const rank = (doc: Doc) => (doc.id === activeIdRef.current ? 1 : 0);
      return rank(b) - rank(a);
    });

    for (const doc of ordered.slice(0, STALE_SYNC_LIMIT)) {
      if (doc.id === activeIdRef.current) {
        // 正在看它：屏幕上的字不偷偷换；等失焦后替换，并明确告知一句
        if (editorFocused.current) continue;
        const rev = doc.remoteRev;
        const ok = await refreshFromRemote(doc.id);
        if (ok) showNotice(`已载入云端新版（v${rev}）`);
      } else {
        await fetchContent(doc.id);
      }
    }
  }, [fetchContent, refreshFromRemote, showNotice]);

  /**
   * 一次完整的后台同步：取 token → 拉元数据 → 上传本机新建 → 差量合并
   * → 补传离线改动 → 静默拉取云端新版。
   * 打开时、定时间隔、回到前台、恢复联网都会走这一条路径。
   */
  const syncFromServer = useCallback(async () => {
    if (syncInFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    syncInFlight.current = true;

    try {
      const token = await getToken();
      if (!token) {
        setStatus("offline");
        return;
      }

      let server;
      try {
        server = await listDocs(token);
      } catch {
        setStatus("offline");
        return;
      }

      // 1) 本机新建（rev=0）但云端还没有 → 上传
      const serverIds = new Set(server.map((meta) => meta.id));
      for (const local of docsRef.current) {
        if (serverIds.has(local.id) || local.rev > 0) continue;
        try {
          const created = await createDoc(token, {
            id: local.id,
            title: local.title,
            content: local.content,
          });
          updateDoc(local.id, {
            rev: created.rev,
            updatedAt: toMillis(created.updatedAt),
            synced: {
              title: hashText(local.title),
              content: hashText(local.content),
            },
          });
        } catch {
          /* 冲突或离线：保留本机版本，后续保存时会重试 */
        }
      }

      // 2) 本地优先合并：云端没变就一个对象都不换
      const outcome = mergeDocs(docsRef.current, server);
      let merged = outcome.docs;

      // 3) 全新账号：造一篇欢迎文档
      if (merged.length === 0) {
        const welcome = newDoc("欢迎使用 MarkText Web", WELCOME_DOC);
        merged = [welcome];
        try {
          const created = await createDoc(token, {
            id: welcome.id,
            title: welcome.title,
            content: welcome.content,
          });
          welcome.rev = created.rev;
          welcome.updatedAt = toMillis(created.updatedAt);
          welcome.synced = {
            title: hashText(welcome.title),
            content: hashText(welcome.content),
          };
        } catch {
          /* 离线也无所谓，保存时会补建 */
        }
      }

      if (outcome.changed || merged.length !== docsRef.current.length) {
        applyDocs(merged);
      }

      // 当前文档可能在别的设备被删了 → 退到第一篇，别停在空视图
      if (!merged.some((doc) => doc.id === activeIdRef.current)) {
        const next = merged[0]?.id ?? null;
        setActiveId(next);
        activeIdRef.current = next;
      }

      setStatus("idle");
      setEverSynced(true);

      // 4) 本机有未上传的改动 → 排队补传
      for (const id of outcome.pendingUploadIds) queueSave(id);

      // 5) 云端有新版的干净文档 → 后台静默拉取
      await syncStaleDocs();
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [applyDocs, getToken, queueSave, syncStaleDocs, updateDoc]);

  /* ---------------- 初始加载与后台检查 ---------------- */

  useEffect(() => {
    let alive = true;
    rememberUser(userId);

    void (async () => {
      // 本机缓存（IndexedDB）异步读出来再上屏；旧版 localStorage 会自动迁移。
      // 这一步不依赖任何网络：打开就能看到上次的文档。
      const cached = await loadDocs(userId);
      if (!alive) return;

      const resumeId = (() => {
        if (initialDocId && cached.some((d) => d.id === initialDocId)) return initialDocId;
        const last = readLastDocId(userId);
        if (last && cached.some((d) => d.id === last)) return last;
        return cached[0]?.id ?? null;
      })();

      docsRef.current = cached;
      setDocs(cached);
      setActiveId(resumeId);
      activeIdRef.current = resumeId;
      if (resumeId) writeLastDocId(userId, resumeId);
      setReady(true);

      // 打开即检查一次更新，但绝不阻塞上面这一步渲染
      void syncFromServer();
    })();

    return () => {
      alive = false;
    };
    // 只在切换账号时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /**
   * 间隔检查更新：只在页面可见时跑，带抖动避免多标签同拍。
   * 定时器不会因为一次失败就停，下一拍继续。
   */
  useEffect(() => {
    if (!ready) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const delay = SYNC_INTERVAL_MS + Math.floor(Math.random() * SYNC_JITTER_MS);
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") void syncFromServer();
        schedule();
      }, delay);
    };
    schedule();

    // 回到前台 / 恢复联网时立刻补一次
    const check = () => {
      if (document.visibilityState === "visible") void syncFromServer();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, [ready, syncFromServer]);

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
      void saveDocs(userId, docsRef.current);
    };
  }, [flushAll, userId]);

  /* ---------------- URL 与浏览器历史 ---------------- */

  // 当前文档变化时同步地址栏；用 replaceState 避免污染历史
  useEffect(() => {
    if (!ready) return;
    activeIdRef.current = activeId;
    if (activeId) writeLastDocId(userId, activeId);
    const target = activeId ? docPath(activeId) : "/";
    if (window.location.pathname !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [activeId, ready, userId]);

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
      if (id) maybeRefreshRemote(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [maybeRefreshRemote]);

  const selectDoc = useCallback(
    (id: string) => {
      const switching = activeIdRef.current !== id;
      setActiveId(id);
      activeIdRef.current = id;
      window.history.pushState(null, "", docPath(id));
      // 切到一篇「云端有新版本」的文档时，直接载入新版（当前并没有在编辑它）
      if (switching) maybeRefreshRemote(id);
    },
    [maybeRefreshRemote],
  );

  /* ---------------- 操作 ---------------- */

  const active = useMemo(
    () => docs.find((d) => d.id === activeId) ?? null,
    [docs, activeId],
  );

  /**
   * 在「已知有云端新版」的文档上继续改，就等于在旧版本上叠加改动：
   * 立刻升级为显式冲突，让顶部提示条说清楚，而不是等到保存时 409 才让人懵。
   */
  const markStaleEdit = useCallback(
    (id: string, patch: Partial<Doc>) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc) return;
      if (doc.remoteRev && !doc.remoteConflict) {
        updateDoc(id, { ...patch, remoteConflict: true });
        return;
      }
      updateDoc(id, patch);
    },
    [updateDoc],
  );

  const handleChange = useCallback(
    (id: string, markdown: string) => {
      markStaleEdit(id, { content: markdown, updatedAt: Date.now() });
      setSavedAt(null);
      queueSave(id);
    },
    [markStaleEdit, queueSave],
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
          synced: {
            title: hashText(doc.title),
            content: hashText(doc.content),
          },
        });
        setStatus("saved");
      } catch {
        setStatus("offline");
      }
    })();
  }, [applyDocs, getToken, selectDoc, updateDoc]);

  /* PWA 快捷方式 /?new=1：直达新建文档；参数随即抹掉，避免刷新重复建。 */
  useEffect(() => {
    if (!ready || handledNewParam.current) return;
    if (!new URLSearchParams(window.location.search).has("new")) return;
    handledNewParam.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    addDoc();
  }, [ready, addDoc]);

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
      markStaleEdit(activeId, { title, updatedAt: Date.now() });
      setSavedAt(null);
      queueSave(activeId);
    },
    [activeId, markStaleEdit, queueSave],
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
            synced: {
              title: hashText(doc.title),
              content: hashText(doc.content),
            },
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
      synced: {
        title: hashText(server.title),
        content: hashText(server.content),
      },
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

    const synced = {
      title: hashText(doc.title),
      content: hashText(doc.content),
    };

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
          synced,
        });
        setConflict(null);
        setSavedAt(Date.now());
        setStatus("saved");
      } catch {
        setStatus("offline");
      }
    })();
  }, [conflict, getToken, updateDoc]);

  /**
   * 「用本机覆盖」：强制 PUT（不带 rev），把本机这份推到云端并清除冲突标记。
   * 用于「云端更新了，但我在旧版本上改过，且我选保留我的改动」。
   */
  const forceSaveLocal = useCallback(
    async (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc) return;

      const token = await getToken();
      if (!token) {
        setStatus("offline");
        return;
      }

      const synced = {
        title: hashText(doc.title),
        content: hashText(doc.content),
      };
      try {
        const saved = await saveDoc(token, id, {
          title: doc.title,
          content: doc.content,
        });
        updateDoc(id, {
          rev: saved.rev,
          updatedAt: toMillis(saved.updatedAt),
          synced,
          remoteRev: undefined,
          remoteTitle: undefined,
          remoteConflict: undefined,
        });
        setConflict(null);
        setSavedAt(Date.now());
        setStatus("saved");
        showNotice("已用本机版本覆盖云端");
      } catch {
        setStatus("offline");
      }
    },
    [getToken, showNotice, updateDoc],
  );

  const handleLogout = useCallback(async () => {
    flushAll();
    // 跳转前把本机缓存写完，避免丢掉最后一段编辑
    await saveDocs(userId, docsRef.current);
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }, [flushAll, logout, userId]);

  const relogin = useCallback(async () => {
    flushAll();
    await saveDocs(userId, docsRef.current);
    try {
      await logout();
    } catch {
      /* 会话已失效时 logout 也可能失败，忽略 */
    } finally {
      window.location.assign("/login");
    }
  }, [flushAll, logout, userId]);

  if (!ready) {
    return (
      <Splash
        text="正在加载文档…"
        detail="先用本机缓存打开，随后与云端合并。"
      />
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

        <DocList
          docs={docs}
          activeId={activeId}
          onSelect={selectDoc}
          onDelete={deleteDoc}
          onPrefetch={(id) => void ensureContent(id)}
          empty={
            syncing ? <DocListSkeleton rows={4} /> : <p className="empty-hint">还没有文档</p>
          }
        />

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
                  {status === "saving" && <Spinner size={10} />}
                  {statusText}
                </span>
                <button onClick={() => fileRef.current?.click()} disabled={exporting}>
                  导入
                </button>
                <button onClick={exportDoc} disabled={exporting}>
                  {exporting ? (
                    <>
                      <Spinner size={11} /> 导出中…
                    </>
                  ) : (
                    "导出 .md"
                  )}
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

            {/* 你正在看的这篇是旧版本：明确告诉你，但不偷偷改屏幕上的字 */}
            {active.remoteRev && !active.remoteConflict && !conflict && (
              <div className="remote-bar">
                <span>
                  当前显示的是旧版本：云端已到 v{active.remoteRev}。
                  {active.remoteTitle && active.remoteTitle !== active.title
                    ? ` 云端标题：${active.remoteTitle}`
                    : ""}
                </span>
                <button onClick={() => void refreshFromRemote(active.id)}>
                  载入新版
                </button>
              </div>
            )}

            {/* 你在旧版本上又改过：这是真冲突，必须由你决定 */}
            {active.remoteConflict && !conflict && (
              <div className="conflict-bar">
                <span>
                  冲突：云端已到 v{active.remoteRev}，而你在旧版本（v{active.rev}）上改过。
                  {active.remoteTitle && active.remoteTitle !== active.title
                    ? ` 云端标题：${active.remoteTitle}`
                    : ""}
                </span>
                <button onClick={() => void refreshFromRemote(active.id)}>
                  载入云端（丢弃我的改动）
                </button>
                <button onClick={() => void forceSaveLocal(active.id)}>
                  用本机覆盖
                </button>
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
                <EditorSkeleton label="正在拉取正文…" />
              ) : (
                <Editor
                  key={`${active.id}:${editorEpoch}`}
                  docId={active.id}
                  initialContent={active.content}
                  onChange={handleChange}
                  onFocusChange={(focused) => {
                    editorFocused.current = focused;
                    // 失焦时补做被推迟的静默更新（用户正在看的时候不打扰）
                    if (!focused) void syncStaleDocs();
                  }}
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

      {notice && (
        <div className="app-toast" role="status" aria-live="polite">
          {notice}
        </div>
      )}
    </div>
  );
}
