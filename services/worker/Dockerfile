# BountyMesh worker daemon — Railway production image.
#
# Build context = repo root (so packages/sdk/dist is reachable for the
# file:-link). Set the Railway service's Root Directory to "/" and Dockerfile
# Path to "services/worker/Dockerfile".
#
# Worker has no HTTP server — Railway healthcheck is omitted. Use
# restartPolicyType=ON_FAILURE so Railway auto-restarts on crash.

# ─── Stage 1: install deps + vendor SDK ─────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

COPY packages/sdk ./packages/sdk
COPY services/orchestrator ./services/orchestrator

# Build-context guard: fails fast with a clear message if Railway's dashboard
# Root Directory drifts off `/` (repo root). Without this, the COPY above
# silently succeeds with an empty packages/sdk and npm install fails much
# later with an opaque "cannot resolve @bountymesh/sdk" error.
RUN test -f /app/packages/sdk/package.json \
  || (echo "ERROR: packages/sdk missing — Railway service Root Directory must be '/' (repo root), not a subdir." && exit 1)
RUN test -f /app/services/orchestrator/package.json \
  || (echo "ERROR: services/orchestrator missing — Railway service Root Directory must be '/' (repo root), not a subdir." && exit 1)

# Build the orchestrator's dist/ ahead of npm install --install-links so the
# file: link in services/worker/package.json resolves to a directory with the
# compiled JS + .d.ts the worker imports.
WORKDIR /app/services/orchestrator
RUN npm install --legacy-peer-deps && npm run build

COPY services/worker/package.json services/worker/package-lock.json /app/services/worker/

WORKDIR /app/services/worker
RUN npm install --legacy-peer-deps --install-links

# ─── Stage 2: TypeScript build ──────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app /app
COPY services/worker ./services/worker
COPY idl/external/vara_bridge.idl ./services/worker/vara_bridge.idl
COPY idl/external/infinite_bounties.idl ./services/worker/infinite_bounties.idl

WORKDIR /app/services/worker
RUN npm run build

# ─── Stage 3: production runtime ────────────────────────────────────────
FROM node:24-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/services/worker/dist ./dist
COPY --from=build /app/services/worker/node_modules ./node_modules
COPY --from=build /app/services/worker/package.json ./package.json
COPY --from=build /app/services/worker/vara_bridge.idl ./vara_bridge.idl
COPY --from=build /app/services/worker/infinite_bounties.idl ./infinite_bounties.idl

# Worker process — no exposed port, no HTTP server. Stdin/stdout for logs.
CMD ["node", "dist/main.js"]
