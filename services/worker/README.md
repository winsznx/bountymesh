# @bountymesh/worker

BountyMesh reference worker — autonomous bounty claimer.

Reference worker implementation. Other Vara A2A builders can fork as a canonical agent pattern.

## Run

From the repo root:

- `make worker-install` — `npm install --legacy-peer-deps` inside `services/worker/`. SDK peer-dep skew mirrors the indexer's situation.
- `make worker-build` — `tsc -p tsconfig.build.json` → `dist/`. Auto-depends on `make sdk-build` (downstream consumers read the SDK via `dist/`; the dep keeps the dist fresh).
- `make worker-start` — `node dist/main.js`. Boots the worker process.
- `make worker-build-clean` — `rm -rf dist node_modules`.

## Configuration

All config is read from environment variables at boot via `loadConfig()`. Missing-required or invalid values fail-fast with a structured `ConfigError` listing every issue at once (boot prints all errors before exit — operator sees the full list per restart, not one-at-a-time).

### Required (no default)

| Var | Format | Description |
|---|---|---|
| `VARA_RPC_URL` | `ws://` or `wss://` URL | Vara chain WebSocket endpoint |
| `BOUNTYMESH_PROGRAM_ID` | 0x + 64 hex chars | Deployed bountymesh program ID |
| `INDEXER_BASE_URL` | `http://` or `https://` URL | Indexer base URL (worker derives `/graphql` + `/health`) |
| `WORKER_TRACK` | `Services` / `Social` / `Economy` / `Open` | Bounty track the worker handles (v1 reference impl tests only `Services`) |
| `WORKER_MIN_REWARD_ATOMIC` | bigint decimal string (≥ 0) | Minimum reward in atomic units |

### Optional (with defaults)

| Var | Default | Description |
|---|---|---|
| `INDEXER_MAX_LAG_BLOCKS` | `100` | Max acceptable lag between indexer and chain head on boot |
| `WORKER_KEYSTORE_PATH` | `~/.vara-wallet/accounts/bountymesh-worker-1.json` | Keystore JSON file path |
| `WORKER_ADAPTER` | `claude-api` | WorkAdapter selection (v1: claude-api only) |
| `ANTHROPIC_MODEL` | `claude-opus-4-7` | Anthropic model ID used by the Claude adapter |
| `WORKER_STATE_PATH` | `$CWD/worker.state.json` | Inflight + pointers state file |
| `WORKER_HISTORY_PATH` | `$CWD/worker.history.jsonl` | Append-only history log |
| `WORKER_RESUME_TTL_MS` | `21600000` (6h) | Stale-claim abandon threshold on boot resume |
| `LOG_LEVEL` | `info` | Pino log level |

### Secrets read directly (NOT in WorkerConfig)

These are read at the boundary where they're used, NOT through `loadConfig`, to keep them out of any logged config object:

- `BOUNTYMESH_WORKER_SEED` — Sr25519 URI or BIP-39 mnemonic. Read by `src/signer/env.ts` as the keystore fallback.
- `ANTHROPIC_API_KEY` — `sk-ant-…`. Read by the Claude adapter at construction time.

## Architecture

WorkAdapter pattern + Main FSM + Pending-Accept Monitor, structural-only filter, indexer-driven resume. See `src/` for the canonical implementation.
