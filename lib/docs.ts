import { idbDelete, idbGet, idbPut } from "./idb";

export interface Doc {
  id: string;
  title: string;
  content: string;
  /** 服务端版本号；0 表示尚未同步过 */
  rev: number;
  updatedAt: number;
  /** 正文是否已从服务端拉取（列表接口只返回元数据） */
  loaded?: boolean;
  /**
   * 云端已知版本的字段指纹（标题/正文各自一份）。
   * 增量同步靠它判断「哪些字段真的变了」：只改标题时不必重传整篇正文。
   * 没有该字段（旧缓存或从未同步）时按「全都变了」处理，宁可多传一次。
   */
  synced?: { title?: string; content?: string };
  /**
   * 云端有更高的 rev（其它设备改过），但本地正文还没换。
   * 本地干净时：后台静默拉下来替换，不打扰用户。
   * 本地也有未上传改动时：置 remoteConflict，交给用户裁决。
   */
  remoteRev?: number;
  /** 云端新版的标题，用于提示文案（正文拉取后清空） */
  remoteTitle?: string;
  /** 本地和云端都改过 → 真冲突，必须由用户选择保留哪份 */
  remoteConflict?: boolean;
}

/** 双通道 FNV-1a：够快、够稳，用于字段变更检测（不是安全哈希）。 */
export function hashText(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
    h2 ^= h2 >>> 13;
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

const NS = "marktext-web";
const LAST_USER_KEY = `${NS}:last-user`;
const CACHE_STORE = "docs";

/** 旧版本把整份列表塞在 localStorage 里，这里只用于一次性迁移。 */
function legacyKey(userId: string): string {
  return `${NS}:user:${userId}:docs`;
}

interface CacheRecord {
  userId: string;
  docs: Doc[];
  savedAt: number;
}

export const WELCOME_DOC = `# 欢迎使用 MarkText Web

这是从 [MarkText](https://github.com/marktext/marktext) 的编辑器内核 **muya** 构建的网页版。

## 支持

- CommonMark + GFM：标题、列表、任务列表、表格、代码块、引用
- **粗体**、*斜体*、~~删除线~~、\`行内代码\`
- KaTeX 数学公式、Mermaid 图表
- 实时预览、快捷插入、查找替换

## 开始

1. 左侧新建文档，或导入本地 \`.md\` 文件
2. 编辑内容会自动保存到云端，换设备登录即可看到
3. 右上角可导出 Markdown

> 文档按账号隔离：切换账号看不到彼此的文档。断网时仍可编辑，恢复后自动同步。
`;

export function newDoc(title = "未命名文档", content = ""): Doc {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    rev: 0,
    updatedAt: Date.now(),
    loaded: true,
  };
}

/** 旧缓存里字段可能缺失或类型不对，统一收敛成可用的 Doc。 */
function normalize(raw: unknown): Doc[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is Doc =>
        !!d &&
        typeof d === "object" &&
        typeof (d as Doc).id === "string" &&
        typeof (d as Doc).content === "string",
    )
    .map((d) => ({
      ...d,
      title: typeof d.title === "string" ? d.title : "",
      rev: typeof d.rev === "number" ? d.rev : 0,
      updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
      loaded: true,
    }));
}

function readLegacy(userId: string): Doc[] {
  try {
    const raw = window.localStorage.getItem(legacyKey(userId));
    if (!raw) return [];
    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * 读本机缓存：IndexedDB 优先，首次运行把旧 localStorage 数据迁移过来。
 * 读不出来就当空缓存——服务端仍是真源。
 */
export async function loadDocs(userId: string): Promise<Doc[]> {
  if (typeof window === "undefined") return [];

  const record = await idbGet<CacheRecord>(CACHE_STORE, userId);
  if (record && Array.isArray(record.docs)) return normalize(record.docs);

  const legacy = readLegacy(userId);
  if (legacy.length > 0) {
    await idbPut(CACHE_STORE, {
      userId,
      docs: legacy,
      savedAt: Date.now(),
    } satisfies CacheRecord);
    try {
      window.localStorage.removeItem(legacyKey(userId));
    } catch {
      /* 迁移失败也不影响使用，下次再试 */
    }
    return legacy;
  }

  return [];
}

/**
 * 写本机缓存。只缓存已加载正文的文档，避免把空壳当成真实内容。
 * IDB 写入失败（隐私模式 / 配额）时退回 localStorage，尽量保住最后一版。
 */
export async function saveDocs(userId: string, docs: Doc[]): Promise<void> {
  if (typeof window === "undefined") return;

  const payload = docs.filter((d) => d.loaded !== false);
  const record: CacheRecord = { userId, docs: payload, savedAt: Date.now() };

  const ok = await idbPut(CACHE_STORE, record);
  if (ok) return;

  try {
    window.localStorage.setItem(legacyKey(userId), JSON.stringify(payload));
  } catch {
    /* 两条路都失败：服务端仍是真源，不打断编辑 */
  }
}

/** 换号守卫：记录上次登录用户，按 userId 命名空间读取，天然不串号。 */
export function rememberUser(userId: string): { switched: boolean } {
  if (typeof window === "undefined") return { switched: false };
  const prev = window.localStorage.getItem(LAST_USER_KEY);
  window.localStorage.setItem(LAST_USER_KEY, userId);
  return { switched: prev !== null && prev !== userId };
}

export function lastKnownUser(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

/** 上次打开的文档：刷新/重进时直接回到同一篇，不必等列表同步再决定。 */
function lastDocKey(userId: string): string {
  return `${NS}:last-doc:${userId}`;
}

export function readLastDocId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(lastDocKey(userId));
  } catch {
    return null;
  }
}

export function writeLastDocId(userId: string, docId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastDocKey(userId), docId);
  } catch {
    /* 记不住就退回「第一篇」，不影响功能 */
  }
}

export async function clearUserDocs(userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  await idbDelete(CACHE_STORE, userId);
  try {
    window.localStorage.removeItem(legacyKey(userId));
  } catch {
    /* ignore */
  }
}
