import { NextResponse, type NextRequest } from "next/server";

/**
 * Same-origin proxy to the indexer.
 *
 * Why this exists: NEXT_PUBLIC_* env vars are baked into the browser bundle,
 * and the indexer only has a Railway *private* domain
 * (bountymesh-indexer.railway.internal) which the browser cannot resolve.
 * Exposing the indexer on a public Railway domain hits a railway-edge redirect
 * to the canonical host. So instead the browser calls this route on the
 * frontend's own origin (www.bountymesh.xyz/api/indexer/...) and the frontend's
 * Node server forwards to the indexer over Railway's private network.
 *
 * Benefits: no CORS, no public indexer exposure, no NEXT_PUBLIC build-time URL,
 * private-network egress.
 *
 * Target resolved at RUNTIME (not build time) from INDEXER_INTERNAL_URL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function indexerOrigin(): string {
  return (
    process.env.INDEXER_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_INDEXER_URL ??
    "http://localhost:4350"
  ).replace(/\/$/, "");
}

async function forward(req: NextRequest, path: string[]): Promise<Response> {
  const target = `${indexerOrigin()}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const init: RequestInit = {
    method: req.method,
    headers,
    // GET/HEAD must not carry a body.
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    redirect: "manual",
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
        error: "indexer-unreachable",
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
