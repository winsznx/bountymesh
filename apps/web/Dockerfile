# BountyMesh frontend — Railway production image.
#
# Build context = repo root (so packages/sdk/dist is reachable for the
# file:-link). Set the Railway service's Root Directory to "/" and Dockerfile
# Path to "apps/web/Dockerfile" — same monorepo pattern as the indexer.

# ─── Stage 1: install deps + vendor SDK ─────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# SDK first — apps/web/package.json carries "file:../../packages/sdk"
COPY packages/sdk ./packages/sdk

# Build-context guard: fails fast with a clear message if Railway's dashboard
# Root Directory drifts off `/` (repo root). Without this, the COPY above
# silently succeeds with an empty packages/sdk and npm install fails much
# later with an opaque "cannot resolve @bountymesh/sdk" error.
RUN test -f /app/packages/sdk/package.json \
  || (echo "ERROR: packages/sdk missing — Railway service Root Directory must be '/' (repo root), not a subdir." && exit 1)

# Web app manifest + lockfile
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/

WORKDIR /app/apps/web
RUN npm install --legacy-peer-deps --install-links

# ─── Stage 2: Next.js production build ──────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app /app
COPY apps/web ./apps/web

# NEXT_PUBLIC_* env vars are substituted INTO the client bundle at build
# time. Docker build only sees vars declared as ARG, so we ARG-then-ENV
# each one — Railway forwards same-named service env vars as build args
# automatically. Without these ARG lines, npm run build sees `undefined`
# and the browser bundle ships `if (!PROGRAM_ID) throw ...` failures.
ARG NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID
ARG NEXT_PUBLIC_VARA_WS
ARG NEXT_PUBLIC_INDEXER_URL
ARG NEXT_PUBLIC_CHAIN_SS
ARG NEXT_PUBLIC_DEMO_VERIFIED_BOUNTY_ID
ENV NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID=$NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID
ENV NEXT_PUBLIC_VARA_WS=$NEXT_PUBLIC_VARA_WS
ENV NEXT_PUBLIC_INDEXER_URL=$NEXT_PUBLIC_INDEXER_URL
ENV NEXT_PUBLIC_CHAIN_SS=$NEXT_PUBLIC_CHAIN_SS
ENV NEXT_PUBLIC_DEMO_VERIFIED_BOUNTY_ID=$NEXT_PUBLIC_DEMO_VERIFIED_BOUNTY_ID

ENV NEXT_OUTPUT_FILE_TRACING_ROOT=/app

WORKDIR /app/apps/web
RUN npm run build

# ─── Stage 3: production runtime ────────────────────────────────────────
FROM node:24-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production
# Bind to whatever port Railway sets (defaults to 3000 for the Next standalone server)
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Standalone output bundles server.js + a minimal node_modules subtree.
# Layout: /app/apps/web/server.js (entry) + /app/apps/web/.next/static (CSS/JS)
# + /app/apps/web/public (static assets)
COPY --from=build /app/apps/web/.next/standalone /app/
COPY --from=build /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /app/apps/web/public /app/apps/web/public

EXPOSE 3000

# Healthcheck — Next 16 serves the OG card route + landing under root, no
# dedicated /health endpoint. The landing returns 200 once the server boots.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
  CMD wget --spider -q "http://127.0.0.1:${PORT:-3000}/" || exit 1

WORKDIR /app/apps/web
CMD ["node", "server.js"]
