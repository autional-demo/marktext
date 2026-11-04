import type { NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { errorResponse, requireCaller } from "@/lib/server/auth";
import {
  parseContent,
  parseDocId,
  parseTitle,
  sealContent,
  sealTitle,
  toDoc,
  type DocumentRow,
} from "@/lib/server/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "sin1";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const caller = await requireCaller(req);
    const id = parseDocId((await ctx.params).id);
    const sql = db();

    const rows = (await sql`
      select id, title, content, rev, created_at, updated_at
      from documents
      where id = ${id}
        and tenant_id = ${caller.tenantId}
        and user_id = ${caller.userId}
        and deleted_at is null
      limit 1
    `) as unknown as DocumentRow[];

    if (rows.length === 0) {
      return Response.json({ error: "文档不存在" }, { status: 404 });
    }
    return Response.json({ doc: toDoc(rows[0], caller) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * 保存。
 * - 带 rev：乐观并发控制，rev 不匹配返回 409 + 云端当前版本
 * - 不带 rev：强制覆盖（用于用户明确选择「用本机覆盖云端」）
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const caller = await requireCaller(req);
    const id = parseDocId((await ctx.params).id);
    const body = (await req.json()) as Record<string, unknown>;

    const title = sealTitle(caller, id, parseTitle(body.title));
    const content = sealContent(caller, id, parseContent(body.content));
    const hasRev =
      typeof body.rev === "number" && Number.isInteger(body.rev) && body.rev >= 0;

    const sql = db();
    const rows = (hasRev
      ? await sql`
          update documents
          set title = ${title}, content = ${content}, rev = rev + 1, updated_at = now()
          where id = ${id}
            and tenant_id = ${caller.tenantId}
            and user_id = ${caller.userId}
            and deleted_at is null
            and rev = ${body.rev as number}
          returning id, title, content, rev, created_at, updated_at
        `
      : await sql`
          update documents
          set title = ${title}, content = ${content}, rev = rev + 1, updated_at = now()
          where id = ${id}
            and tenant_id = ${caller.tenantId}
            and user_id = ${caller.userId}
            and deleted_at is null
          returning id, title, content, rev, created_at, updated_at
        `) as unknown as DocumentRow[];

    if (rows.length > 0) {
      return Response.json({ doc: toDoc(rows[0], caller) });
    }

    const current = (await sql`
      select id, title, content, rev, created_at, updated_at
      from documents
      where id = ${id}
        and tenant_id = ${caller.tenantId}
        and user_id = ${caller.userId}
        and deleted_at is null
      limit 1
    `) as unknown as DocumentRow[];

    if (current.length === 0) {
      return Response.json({ error: "文档不存在" }, { status: 404 });
    }

    return Response.json(
      { error: "版本冲突", doc: toDoc(current[0], caller) },
      { status: 409 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/** 软删除，保留 rev 递增，便于其它设备感知。 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const caller = await requireCaller(req);
    const id = parseDocId((await ctx.params).id);
    const sql = db();

    const rows = (await sql`
      update documents
      set deleted_at = now(), rev = rev + 1, updated_at = now()
      where id = ${id}
        and tenant_id = ${caller.tenantId}
        and user_id = ${caller.userId}
        and deleted_at is null
      returning id
    `) as unknown as Array<{ id: string }>;

    if (rows.length === 0) {
      return Response.json({ error: "文档不存在" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
