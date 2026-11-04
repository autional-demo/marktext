export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM = "https://api.autional.cn/.well-known/openid-configuration";

export async function GET() {
  const upstream = await fetch(UPSTREAM, { cache: "no-store" });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
