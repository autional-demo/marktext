"use client";

import { useEffect, useRef, useState } from "react";
import type { Doc } from "@/lib/docs";

/**
 * 侧栏文档列表的窗口化渲染。
 *
 * 文档上百条时，整列表全量渲染会拖慢首次上屏与每次编辑后的重渲染。
 * 这里只渲染视口内的行（固定行高，标题单行省略），滚动时用一块
 * 占位高度撑出滚动条，逻辑 O(可见行数) 而不是 O(总量)。
 */

/** 行距：行高 34 + 间隔 2，必须与 CSS 里的 .doc-item--virtual 保持一致 */
const ROW_PITCH = 36;
const OVERSCAN = 8;

interface DocListProps {
  docs: Doc[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onPrefetch?: (id: string) => void;
  empty?: React.ReactNode;
}

export default function DocList({
  docs,
  activeId,
  onSelect,
  onDelete,
  onPrefetch,
  empty,
}: DocListProps) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const lastActive = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);

  // 视口高度随窗口/侧栏变化
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 480);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 切到列表外的文档（深链 / 前进后退）时把它滚进视野
  useEffect(() => {
    if (!activeId || lastActive.current === activeId) return;
    lastActive.current = activeId;
    const el = scrollRef.current;
    const index = docs.findIndex((d) => d.id === activeId);
    if (!el || index < 0) return;

    const top = index * ROW_PITCH;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_PITCH > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_PITCH - el.clientHeight;
    }
  }, [activeId, docs]);

  const total = docs.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_PITCH) - OVERSCAN);
  const count = Math.ceil(viewport / ROW_PITCH) + OVERSCAN * 2;
  const visible = docs.slice(first, Math.min(total, first + count));

  return (
    <nav
      className="doc-list"
      aria-label="文档列表"
      ref={(node) => {
        scrollRef.current = node;
      }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {total === 0
        ? empty
        : (
            <div className="doc-list-window" style={{ height: total * ROW_PITCH }}>
              <div
                className="doc-list-slice"
                style={{ transform: `translateY(${first * ROW_PITCH}px)` }}
              >
                {visible.map((doc) => (
                  <div
                    key={doc.id}
                    className={`doc-item doc-item--virtual ${
                      doc.id === activeId ? "active" : ""
                    }`}
                    onClick={() => onSelect(doc.id)}
                    onMouseEnter={() => onPrefetch?.(doc.id)}
                    onFocus={() => onPrefetch?.(doc.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") onSelect(doc.id);
                    }}
                  >
                    <span className="doc-title">{doc.title || "未命名文档"}</span>
                    {doc.remoteConflict && (
                      <span
                        className="doc-conflict"
                        title="云端有新版，本机这篇也改过（打开后可选择保留哪份）"
                      />
                    )}
                    {doc.loaded === false && (
                      <span className="doc-pending" title="正文加载中" />
                    )}
                    <button
                      className="doc-delete"
                      title="删除"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(doc.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
    </nav>
  );
}
