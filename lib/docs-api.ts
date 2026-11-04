"use client";

export interface ApiDoc {
  id: string;
  title: string;
  content: string;
  rev: number;
  updatedAt: string;
}

export interface ApiDocMeta {
  id: string;
  title: string;
  rev: number;
  updatedAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const body = data as { error?: string; doc?: ApiDoc } | null;
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  }

  return data as T;
}

export async function listDocs(token: string): Promise<ApiDocMeta[]> {
  const data = await call<{ docs: ApiDocMeta[] }>(token, "/api/docs");
  return data.docs;
}

export async function getDoc(token: string, id: string): Promise<ApiDoc> {
  const data = await call<{ doc: ApiDoc }>(token, `/api/docs/${encodeURIComponent(id)}`);
  return data.doc;
}

export async function createDoc(
  token: string,
  doc: { id?: string; title: string; content: string },
): Promise<ApiDoc> {
  const data = await call<{ doc: ApiDoc }>(token, "/api/docs", {
    method: "POST",
    body: JSON.stringify(doc),
  });
  return data.doc;
}

export async function saveDoc(
  token: string,
  id: string,
  patch: { title: string; content: string; rev?: number },
): Promise<ApiDoc> {
  const data = await call<{ doc: ApiDoc }>(token, `/api/docs/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return data.doc;
}

export async function removeDoc(token: string, id: string): Promise<void> {
  await call<{ ok: true }>(token, `/api/docs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
