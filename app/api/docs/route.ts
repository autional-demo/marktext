import type { NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { errorResponse, requireCaller } from "@/lib/server/auth";
import {
  MAX_LIST_SIZE,
  parseContent,
  parseOptionalDocId,
  parseTitle,
  sealContent,
  sealTitle,
  toDoc,
  toMeta,
  type DocumentRow,
} from "@/lib/server/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "sin1";

/** 列表：只返回元数据，正文按需拉取。 */
export async function GET(req: NextRequest) {
  try {
    const caller = await requireCaller(req);
    const sql = db();

    const rows = (await sql`
      select id, title, rev, created_at, updated_at
      from documents
      where tenant_id = ${caller.tenantId}
        and user_id = ${caller.userId}
        and deleted_at is null
      order by updated_at desc
      limit ${MAX_LIST_SIZE}
    `) as unknown as Array<Omit<DocumentRow, "content">>;

    return Response.json({ docs: rows.map((row) => toMeta(row, caller)) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 新建。允许客户端带上 id（用于把本机旧数据上传）。 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireCaller(req);
    const body = (await req.json()) as Record<string, unknown>;

    const id = parseOptionalDocId(body.id);
    const title = parseTitle(body.title ?? "未命名文档");
    const content = parseContent(body.content ?? "");

    const sql = db();
    const rows = (await sql`
      insert into documents (id, tenant_id, user_id, title, content)
      values (
        ${id},
        ${caller.tenantId},
        ${caller.userId},
        ${sealTitle(caller, id, title)},
        ${sealContent(caller, id, content)}
      )
      on conflict (id) do nothing
      returning id, title, content, rev, created_at, updated_at
    `) as unknown as DocumentRow[];

    if (rows.length === 0) {
      return Response.json({ error: "文档 id 已存在" }, { status: 409 });
    }

    return Response.json({ doc: toDoc(rows[0], caller) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
