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
COPY services/worker/package.json services/worker/package-lock.json ./services/worker/

WORKDIR /app/services/worker
RUN npm install --legacy-peer-deps --install-links

# ─── Stage 2: TypeScript build ──────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app /app
COPY services/worker ./services/worker

WORKDIR /app/services/worker
RUN npm run build

# ─── Stage 3: production runtime ────────────────────────────────────────
FROM node:24-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/services/worker/dist ./dist
COPY --from=build /app/services/worker/node_modules ./node_modules
COPY --from=build /app/services/worker/package.json ./package.json

# Worker process — no exposed port, no HTTP server. Stdin/stdout for logs.
CMD ["node", "dist/main.js"]
