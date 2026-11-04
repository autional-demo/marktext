import { NextRequest } from "next/server";

const UPSTREAM = "https://api.autional.cn/bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORWARD_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "accept-language",
  "x-tenant-id",
  "x-request-id",
  "x-stepup-token",
  "x-idempotency-key",
  "dpop",
  "dpop-nonce",
];

const COPY_RESPONSE_HEADERS = ["content-type", "x-request-id", "dpop-nonce"];

async function forward(req: NextRequest, path: string[], search: string) {
  const target = `${UPSTREAM}/${path.join("/")}${search}`;

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    return Response.json(
      {
        title: "upstream unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of COPY_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return forward(req, path, req.nextUrl.search);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return forward(req, path, req.nextUrl.search);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return forward(req, path, req.nextUrl.search);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return forward(req, path, req.nextUrl.search);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return forward(req, path, req.nextUrl.search);
}
