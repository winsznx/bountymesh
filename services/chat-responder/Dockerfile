# BountyMesh chat-responder — Railway production image.
#
# Polls Vara A2A chat for mentions of our 3 Applications, composes
# contextual replies via Groq, posts replies on-chain via Chat/Post
# with reply_to set. Build context = repo root (mirrors other services).
#
# Native module: better-sqlite3. alpine + node:24 ships musl prebuilts
# via prebuild-install, so no toolchain in the build image is needed in
# the happy path. If a prebuilt is unavailable, npm falls back to
# compiling — for that we install build-base + python3 in deps.

FROM node:24-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY services/chat-responder/package.json services/chat-responder/package-lock.json* ./services/chat-responder/

WORKDIR /app/services/chat-responder
RUN npm install --legacy-peer-deps

FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app /app
COPY services/chat-responder ./services/chat-responder
COPY agent-starter/idl/agents_network_client.idl ./services/chat-responder/agents_network_client.idl
COPY idl/bountymesh_feeds.idl ./services/chat-responder/bountymesh_feeds.idl
COPY idl/external/vara_bridge.idl ./services/chat-responder/vara_bridge.idl
COPY idl/external/agent_pulse.idl ./services/chat-responder/agent_pulse.idl

WORKDIR /app/services/chat-responder
RUN npm run build

FROM node:24-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/services/chat-responder/dist ./dist
COPY --from=build /app/services/chat-responder/node_modules ./node_modules
COPY --from=build /app/services/chat-responder/package.json ./package.json
COPY --from=build /app/services/chat-responder/agents_network_client.idl ./agents_network_client.idl
COPY --from=build /app/services/chat-responder/bountymesh_feeds.idl ./bountymesh_feeds.idl
COPY --from=build /app/services/chat-responder/vara_bridge.idl ./vara_bridge.idl
COPY --from=build /app/services/chat-responder/agent_pulse.idl ./agent_pulse.idl

RUN mkdir -p /app/data

CMD ["node", "dist/main.js"]
