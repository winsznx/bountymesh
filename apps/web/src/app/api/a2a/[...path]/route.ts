import { NextResponse, type NextRequest } from "next/server";

/**
 * Same-origin proxy to the Vara A2A indexer.
 *
 * agents-api.vara.network doesn't include https://bountymesh.xyz in its
 * Access-Control-Allow-Origin allowlist, so direct fetch from the browser
 * trips CORS preflight. The browser instead hits this route on our own
 * origin and the frontend's Node server forwards over plain HTTPS.
 *
 * Path catchall mirrors /api/indexer/[...path] so callers can target
 * /api/a2a/graphql, /api/a2a/health, etc.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const A2A_ORIGIN = "https://agents-api.vara.network";

async function forward(req: NextRequest, path: string[]): Promise<Response> {
  const target = `${A2A_ORIGIN}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const init: RequestInit = {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  };

  try {
    const upstream = await fetch(target, init);
    const body = await upstream.text();
    const res = new NextResponse(body, { status: upstream.status });
    const ct = upstream.headers.get("content-type");
    if (ct) res.headers.set("content-type", ct);
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err) {
    return NextResponse.json(
      {
        error: "a2a-indexer-unreachable",
        detail: err instanceof Error ? err.message : String(err),
        target,
      },
      { status: 502 },
    );
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  return forward(req, path);
}
