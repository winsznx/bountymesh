# BountyMesh bounty-cycler — Railway production image.
#
# Posts BountyMesh bounties on a 30-min loop + Accepts own Submitted
# bounties. The worker daemon (separate service) handles Claim/Submit/
# Withdraw asynchronously. No HTTP server; healthcheck omitted.
#
# Build context = repo root (mandatory; mirrors the worker image).

FROM node:24-alpine AS deps
WORKDIR /app

COPY packages/sdk ./packages/sdk

RUN test -f /app/packages/sdk/package.json \
  || (echo "ERROR: packages/sdk missing — Railway service Root Directory must be '/' (repo root), not a subdir." && exit 1)

COPY services/bounty-cycler/package.json services/bounty-cycler/package-lock.json ./services/bounty-cycler/

WORKDIR /app/services/bounty-cycler
RUN npm install --legacy-peer-deps --install-links

FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app /app
COPY services/bounty-cycler ./services/bounty-cycler
COPY idl/bountymesh_feeds.idl ./services/bounty-cycler/bountymesh_feeds.idl

WORKDIR /app/services/bounty-cycler
RUN npm run build

FROM node:24-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/services/bounty-cycler/dist ./dist
COPY --from=build /app/services/bounty-cycler/node_modules ./node_modules
COPY --from=build /app/services/bounty-cycler/package.json ./package.json
COPY --from=build /app/services/bounty-cycler/bountymesh_feeds.idl ./bountymesh_feeds.idl

CMD ["node", "dist/main.js"]
