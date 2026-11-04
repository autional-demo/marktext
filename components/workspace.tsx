"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "./editor";
import { useAuth } from "./auth-provider";
import { Doc, loadDocs, newDoc, rememberUser, saveDocs } from "@/lib/docs";

interface WorkspaceProps {
  userId: string;
}

export default function Workspace({ userId }: WorkspaceProps) {
  const { user, logout } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const docsRef = useRef<Doc[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = useCallback(
    (next: Doc[]) => {
      docsRef.current = next;
      setDocs(next);
      saveDocs(userId, next);
    },
    [userId],
  );

  useEffect(() => {
    rememberUser(userId);
    const loaded = loadDocs(userId);
    docsRef.current = loaded;
    setDocs(loaded);
    setActiveId((prev) =>
      prev && loaded.some((d) => d.id === prev) ? prev : (loaded[0]?.id ?? null),
    );
    setReady(true);
  }, [userId]);

  const active = useMemo(
    () => docs.find((d) => d.id === activeId) ?? null,
    [docs, activeId],
  );

  const handleChange = useCallback(
    (markdown: string) => {
      if (!activeId) return;
      const next = docsRef.current.map((d) =>
        d.id === activeId ? { ...d, content: markdown, updatedAt: Date.now() } : d,
      );
      persist(next);
      setSavedAt(Date.now());
    },
    [activeId, persist],
  );

  const addDoc = useCallback(() => {
    const doc = newDoc();
    persist([doc, ...docsRef.current]);
    setActiveId(doc.id);
  }, [persist]);

  const deleteDoc = useCallback(
    (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc) return;
      if (!window.confirm(`删除文档「${doc.title || "未命名文档"}」？此操作不可撤销。`)) {
        return;
      }
      const next = docsRef.current.filter((d) => d.id !== id);
      persist(next);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
    },
    [activeId, persist],
  );

  const renameDoc = useCallback(
    (title: string) => {
      if (!activeId) return;
      const next = docsRef.current.map((d) =>
        d.id === activeId ? { ...d, title, updatedAt: Date.now() } : d,
      );
      persist(next);
    },
    [activeId, persist],
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

  const importDoc = useCallback(
    async (file: File) => {
      const text = await file.text();
      const doc = newDoc(file.name.replace(/\.(md|markdown|txt)$/i, ""), text);
      persist([doc, ...docsRef.current]);
      setActiveId(doc.id);
    },
    [persist],
  );

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }, [logout]);

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-logo">M↓</div>
        <p>正在加载文档…</p>
      </div>
    );
  }

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
              onClick={() => setActiveId(d.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setActiveId(d.id);
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
                <span className="save-state">
                  {savedAt ? "已保存到本机" : "自动保存"}
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
                  if (file) void importDoc(file);
                  e.target.value = "";
                }}
              />
            </header>
            <div className="editor-shell">
              <Editor
                key={active.id}
                docId={active.id}
                initialContent={active.content}
                onChange={handleChange}
              />
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
