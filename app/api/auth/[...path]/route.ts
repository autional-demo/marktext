import type { NextRequest } from "next/server";
import { getAiAuth } from "@/lib/server/ai-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest): Promise<Response> {
  try {
    return await getAiAuth().route(request);
  } catch (err) {
    console.error("[api/auth] unavailable", err);
    return Response.json(
      { error: "auth_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export { handle as GET, handle as POST };
