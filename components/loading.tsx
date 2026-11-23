"use client";

/**
 * 加载态积木：Spinner / 启动页 / 文档列表骨架 / 编辑器骨架。
 * 全部纯 CSS 动画，不引入额外依赖，也不阻塞主线程。
 */

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** 启动页：logo + 转圈 + 一句「正在做什么」，让等待有预期。 */
export function Splash({
  text,
  detail,
  children,
}: {
  text: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="splash">
      <div className="splash-logo">M↓</div>
      <div className="splash-status">
        <Spinner size={13} />
        <p>{text}</p>
      </div>
      {detail && <p className="splash-detail">{detail}</p>}
      {children}
    </div>
  );
}

/** 侧栏骨架：首次进入（本机没有缓存）时占位，避免「空 → 突然出现列表」的跳动。 */
export function DocListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-doc" key={i}>
          <div className="skeleton-bar" style={{ width: `${52 + ((i * 17) % 38)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** 编辑器骨架：正文按行占位，比一行「正在加载文档…」更接近真实布局。 */
export function EditorSkeleton({ label = "正在加载文档…" }: { label?: string }) {
  const widths = ["92%", "78%", "86%", "64%", "88%", "70%"];
  return (
    <div className="editor-skeleton" role="status" aria-live="polite">
      <div className="editor-skeleton-head">
        <Spinner size={13} />
        <span>{label}</span>
      </div>
      <div className="editor-skeleton-body">
        {widths.map((w, i) => (
          <div className="skeleton-bar" key={i} style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}
