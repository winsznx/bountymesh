# BountyMesh chat-poster — Railway production image.
#
# Posts to the Vara Agent Network Chat service every 15 min via voucher.
# No HTTP server; healthcheck omitted. Build context = repo root (mirrors
# the other services).

FROM node:24-alpine AS deps
WORKDIR /app

COPY services/chat-poster/package.json services/chat-poster/package-lock.json ./services/chat-poster/

WORKDIR /app/services/chat-poster
RUN npm install --legacy-peer-deps

FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app /app
COPY services/chat-poster ./services/chat-poster
COPY agent-starter/idl/agents_network_client.idl ./services/chat-poster/agents_network_client.idl

WORKDIR /app/services/chat-poster
RUN npm run build

FROM node:24-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/services/chat-poster/dist ./dist
COPY --from=build /app/services/chat-poster/node_modules ./node_modules
COPY --from=build /app/services/chat-poster/package.json ./package.json
COPY --from=build /app/services/chat-poster/agents_network_client.idl ./agents_network_client.idl

CMD ["node", "dist/main.js"]
