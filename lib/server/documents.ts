import { HttpError } from "./auth";
import { decryptField, encryptField } from "./crypto";

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024; // 2 MB（明文）
export const MAX_LIST_SIZE = 500;

export interface DocumentRow {
  id: string;
  title: string;
  content: string;
  rev: number;
  created_at: string;
  updated_at: string;
}

export interface DocDto {
  id: string;
  title: string;
  content: string;
  rev: number;
  updatedAt: string;
}

export interface DocMetaDto {
  id: string;
  title: string;
  rev: number;
  updatedAt: string;
}

export interface Owner {
  tenantId: string;
  userId: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function parseDocId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new HttpError(400, "文档 id 非法");
  }
  return value;
}

export function parseOptionalDocId(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return crypto.randomUUID();
  }
  return parseDocId(value);
}

export function parseTitle(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "title 必须是字符串");
  if (value.length > MAX_TITLE_LENGTH) {
    throw new HttpError(413, `标题超过 ${MAX_TITLE_LENGTH} 字符`);
  }
  return value;
}

export function parseContent(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "content 必须是字符串");
  if (value.length > MAX_CONTENT_BYTES) {
    throw new HttpError(413, "文档超过 2 MB 上限");
  }
  return value;
}

/** 密文绑定到具体文档与字段，防止跨文档/跨用户搬运。 */
function aad(owner: Owner, docId: string, field: "title" | "content"): string {
  return `${owner.tenantId}|${owner.userId}|${docId}|${field}`;
}

export function sealTitle(owner: Owner, docId: string, title: string): string {
  return encryptField(title, aad(owner, docId, "title"));
}

export function sealContent(owner: Owner, docId: string, content: string): string {
  return encryptField(content, aad(owner, docId, "content"));
}

function open(value: string, owner: Owner, docId: string, field: "title" | "content"): string {
  try {
    return decryptField(value, aad(owner, docId, field));
  } catch (err) {
    // 单条损坏不应拖垮整个列表
    console.error(`[crypto] 解密失败 doc=${docId} field=${field}`, err);
    return "（无法解密）";
  }
}

export function toDoc(row: DocumentRow, owner: Owner): DocDto {
  return {
    id: row.id,
    title: open(row.title, owner, row.id, "title"),
    content: open(row.content, owner, row.id, "content"),
    rev: row.rev,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function toMeta(
  row: Omit<DocumentRow, "content">,
  owner: Owner,
): DocMetaDto {
  return {
    id: row.id,
    title: open(row.title, owner, row.id, "title"),
    rev: row.rev,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
