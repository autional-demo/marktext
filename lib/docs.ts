export interface Doc {
  id: string;
  title: string;
  content: string;
  /** 服务端版本号；0 表示尚未同步过 */
  rev: number;
  updatedAt: number;
  /** 正文是否已从服务端拉取（列表接口只返回元数据） */
  loaded?: boolean;
}

const NS = "marktext-web";
const LAST_USER_KEY = `${NS}:last-user`;

function docsKey(userId: string): string {
  return `${NS}:user:${userId}:docs`;
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

/** 读本地缓存。旧版本数据没有 rev，按 0 处理。 */
export function loadDocs(userId: string): Doc[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(docsKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
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
  } catch {
    return [];
  }
}

export function saveDocs(userId: string, docs: Doc[]): void {
  if (typeof window === "undefined") return;
  try {
    // 只缓存已加载正文的文档，避免把空壳当成真实内容
    const payload = docs.filter((d) => d.loaded !== false);
    window.localStorage.setItem(docsKey(userId), JSON.stringify(payload));
  } catch {
    /* 配额超限等场景忽略，服务端仍是真源 */
  }
}

/** 换号守卫：记录上次登录用户，按 userId 命名空间读取，天然不串号。 */
export function rememberUser(userId: string): { switched: boolean } {
  if (typeof window === "undefined") return { switched: false };
  const prev = window.localStorage.getItem(LAST_USER_KEY);
  window.localStorage.setItem(LAST_USER_KEY, userId);
  return { switched: prev !== null && prev !== userId };
}

export function clearUserDocs(userId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(docsKey(userId));
}
