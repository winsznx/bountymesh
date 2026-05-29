# BountyMesh indexer — Railway production image.
#
# Multi-stage. Build context MUST be the repo root (set rootDirectory in
# Railway service config to `/` and dockerfilePath to `services/indexer/
# Dockerfile`). The indexer's package.json carries a file:-link to
# `../../packages/sdk`; this image vendors the SDK at build time via
# npm install --install-links (copy install, not symlink).

# ─── Stage 1: install deps + vendor SDK ─────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# SDK first — the indexer's npm install needs it resolvable at the file: path
COPY packages/sdk ./packages/sdk

# Indexer package manifest + lockfile
COPY services/indexer/package.json services/indexer/package-lock.json ./services/indexer/

WORKDIR /app/services/indexer
RUN npm install --legacy-peer-deps --install-links

# ─── Stage 2: TypeScript build ──────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app /app
COPY services/indexer ./services/indexer

WORKDIR /app/services/indexer
RUN npm run build

# ─── Stage 3: production runtime ────────────────────────────────────────
FROM node:24-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/services/indexer/dist ./dist
COPY --from=build /app/services/indexer/node_modules ./node_modules
COPY --from=build /app/services/indexer/migrations ./migrations
COPY --from=build /app/services/indexer/package.json ./package.json

# Indexer HTTP server. Railway maps $PORT → this; the indexer reads API_PORT.
EXPOSE 4350

# Health check uses the indexer's own /health endpoint (returns 200 + JSON
# when chain connected + db ok + mode='live')
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
  CMD wget --spider -q "http://127.0.0.1:${API_PORT:-4350}/health" || exit 1

CMD ["node", "dist/main.js"]
