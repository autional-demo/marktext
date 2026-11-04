"use client";

import { useEffect, useRef, useState } from "react";
import "@muyajs/core/lib/core.css";

interface EditorProps {
  docId: string;
  initialContent: string;
  onChange: (docId: string, markdown: string) => void;
}

let pluginsRegistered = false;

/* eslint-disable @typescript-eslint/no-explicit-any */
function registerPlugins(core: any) {
  if (pluginsRegistered) return;
  pluginsRegistered = true;
  const {
    Muya,
    EmojiSelector,
    FootnoteTool,
    InlineFormatToolbar,
    ImageEditTool,
    ImageToolBar,
    ImageResizeBar,
    CodeBlockLanguageSelector,
    LinkTools,
    ParagraphFrontButton,
    ParagraphFrontMenu,
    TableColumnToolbar,
    ParagraphQuickInsertMenu,
    TableDragBar,
    TableRowColumMenu,
    PreviewToolBar,
  } = core;

  const plugins: Array<[unknown, unknown?]> = [
    [EmojiSelector],
    [FootnoteTool],
    [InlineFormatToolbar],
    [
      ImageEditTool,
      { imagePathPicker: async () => "", imageAction: async () => "" },
    ],
    [ImageToolBar],
    [ImageResizeBar],
    [CodeBlockLanguageSelector],
    [
      LinkTools,
      {
        jumpClick: (linkInfo: { href?: string } | null) => {
          const href = linkInfo?.href;
          if (href && /^https?:\/\//.test(href)) {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        },
      },
    ],
    [ParagraphFrontButton],
    [ParagraphFrontMenu],
    [TableColumnToolbar],
    [ParagraphQuickInsertMenu],
    [TableDragBar],
    [TableRowColumMenu],
    [PreviewToolBar],
  ];

  for (const [plugin, options] of plugins) {
    if (plugin) Muya.use(plugin, options ?? {});
  }
}

export default function Editor({ docId, initialContent, onChange }: EditorProps) {
  // Callback ref: the editor is remounted per document, so keep the live host
  // node in state and let the effect follow it.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let instance: { getMarkdown: () => string; destroy: () => void } | null = null;
    let detach: (() => void) | null = null;

    const flush = () => {
      if (disposed || !instance) return;
      let markdown: string;
      try {
        markdown = instance.getMarkdown();
      } catch {
        return;
      }
      onChangeRef.current(docId, markdown);
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, 400);
    };

    (async () => {
      const core = await import("@muyajs/core");
      if (disposed || !host.isConnected) return;
      registerPlugins(core);

      // Muya replaces the node it is given (`container.replaceWith(editor)`).
      // Pass a throwaway child so React keeps owning `.muya-host`; otherwise
      // React's unmount removes an already-detached node and throws
      // NotFoundError: Failed to execute 'removeChild' on 'Node'.
      const mount = document.createElement("div");
      host.replaceChildren(mount);
      const muya = new core.Muya(mount, {
        markdown: initialContent,
        locale: core.zh,
        codeBlockLineNumbers: true,
        autoPairBracket: true,
        autoPairMarkdownSyntax: true,
        autoPairQuote: true,
        footnote: true,
        math: true,
        superSubScript: true,
        frontMatter: true,
      });

      try {
        muya.init();
      } catch (err) {
        console.error("[editor] init failed", err);
        try {
          muya.destroy();
        } catch {
          /* ignore */
        }
        host.innerHTML = `<div class="editor-error">编辑器加载失败：${
          err instanceof Error ? err.message : String(err)
        }</div>`;
        return;
      }

      if (disposed) {
        try {
          muya.destroy();
        } catch {
          /* ignore */
        }
        return;
      }

      instance = muya;
      const root = muya.domNode as HTMLElement;
      const onAnyInput = (event: Event) => {
        const target = event.target as Node | null;
        if (target && root.contains(target)) schedule();
      };
      const onAnyFocusOut = (event: Event) => {
        const target = event.target as Node | null;
        if (target && root.contains(target)) flush();
      };
      document.addEventListener("input", onAnyInput, true);
      document.addEventListener("focusout", onAnyFocusOut, true);
      detach = () => {
        document.removeEventListener("input", onAnyInput, true);
        document.removeEventListener("focusout", onAnyFocusOut, true);
      };
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      flush();
      detach?.();
      try {
        instance?.destroy();
      } catch {
        /* ignore */
      }
      instance = null;
    };
    // initialContent is intentionally read once per document mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, docId]);

  return <div className="muya-host" ref={setHost} />;
}
