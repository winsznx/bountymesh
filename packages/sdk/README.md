# @bountymesh/sdk

TypeScript and Python client for the BountyMesh Sails program on Vara mainnet. Real wallet signing, no mock data.

## Install

```bash
npm install @bountymesh/sdk @polkadot/api @gear-js/api sails-js --legacy-peer-deps
```

- ESM-only. Requires Node >= 20.
- `--legacy-peer-deps` is currently required: upstream sails-js@0.5 peer-deps `@polkadot/util ^13.5.1` while `@polkadot/api 16.x` brings `@polkadot/util ^14`. Resolves once sails-js publishes a peer-dep bump.

For the Python wrapper, see [Python wrapper](#python-wrapper) below — it ships inside this npm package at `node_modules/@bountymesh/sdk/python/bountymesh.py`.

## Quickstart (TypeScript)

```ts
import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { BountyMeshClient } from '@bountymesh/sdk';

const api = await GearApi.create({ providerAddress: 'wss://rpc.vara.network' });
await cryptoWaitReady();
const signer = new Keyring({ type: 'sr25519' }).addFromUri('//Alice'); // dev only
const client = new BountyMeshClient({
  api,
  programId: '0x...', // deployed BountyMesh program ID
  signer,
});

const posted = await client.post({
  title: 'Translate this Sails IDL',
  description: '...',
  acceptance: 'Markdown output, one row per type.',
  reward: 2_000_000_000_000n, // 2 VARA, in atomic units (bigint)
  track: 'Economy',
});

if (posted.ok) {
  console.log('bountyId:', posted.value.bountyId, 'tx:', posted.txHash);
} else {
  console.error('contract rejected:', posted.error);
}
```

For browser-injected wallets (vara-wallet extension, polkadot-js extension), replace the `signer` with an `InjectedSignerWithAddress`:

```ts
const signer = { address: '5Grw...', signer: injectedSigner };
const client = new BountyMeshClient({ api, programId, signer });
```

## TxResult shape

Every mutation method (`post`, `claim`, `submit`, `accept`, `withdraw`) returns a `TxResult<T>` discriminated union — **never throws on contract-level rejections**.

```ts
type TxResult<T> =
  | { ok: true;  value: T;             txHash: HexString; blockHash: HexString }
  | { ok: false; error: BountyMeshError; txHash: HexString; blockHash: HexString };
```

| What happened | What the SDK does |
|---|---|
| Contract returned `Ok(value)` | Resolve `{ ok: true, value, txHash, blockHash }` |
| Contract returned `Err(BountyNotOpen)` (or any typed `Error` variant) | Resolve `{ ok: false, error: 'BountyNotOpen', txHash, blockHash }` |
| RPC drop, signer cancel, programId stale, gas exhausted at message level | **Throws** (transport / protocol failure — not a typed contract Err) |
| Client-side bad input (zero hash to `submit`, malformed programId, etc.) | **Throws TypeError synchronously** before the chain is touched |

The split is deliberate. Worker code should treat:
- `result.ok === false` as "the chain says no — maybe try a different bounty"
- A `throw` as "something is wrong with my setup or the network — retry later or surface to operator"

## Event subscriptions (TypeScript)

```ts
const unsubscribe = await client.onBountyPosted(
  { track: 'Economy', minReward: 1_000_000_000_000n }, // optional filter
  async (event) => {
    console.log('new Economy bounty:', event.id, event.reward, event.txHash);
    // Decide whether to claim
    if (canHandle(event)) await client.claim(event.id);
  },
);

// Later, when done:
unsubscribe();
```

Available subscribers (one per Sails event):
- `client.onBountyPosted(filter, cb)` — filter: `{ track?, minReward?, poster? }`
- `client.onBountyClaimed(filter, cb)` — filter: `{ worker? }`
- `client.onBountySubmitted(filter, cb)` — filter: `{ worker? }`
- `client.onBountyAccepted(filter, cb)` — filter: `{ poster?, worker? }`
- `client.onBountyWithdrawn(filter, cb)` — filter: `{ worker? }`

**Implementation note**: one underlying WebSocket subscription (`api.rpc.chain.subscribeNewHeads`) is shared across all `onBountyX` calls per client instance, regardless of how many event types you watch. Slow callbacks are dispatched fire-and-forget — one subscriber stalling does not block dispatch to the others. Each event carries `blockHash` + `txHash` so consumers can deep-link to a block explorer or correlate with mutation results.

## Reading bounty state — the escape hatch

The SDK **does not** expose `getBounty(id)`. The `Bounty` struct and `BountyStatus` enum are not in the program's IDL surface until DiscoveryService lands (deferred past Phase 2). Workers that need to read on-chain bounty state should pick one of:

1. **Preferred — event-sourced (Phase 4+)**: subscribe to `onBountyPosted` / `onBountyClaimed` / `onBountySubmitted` / `onBountyAccepted` / `onBountyWithdrawn` and maintain client-side state from the event stream. This is how the reference worker is built.
2. **GraphQL — once available (Phase 3+)**: query the BountyMesh indexer's GraphQL endpoint (URL TBD until Phase 3 deploys). Typed, paginated, joins, filters — the supported state-read path for production frontends.
3. **Raw — debug only (now)**: drop to `@polkadot/api` directly:

   ```ts
   const programState = await api.query.gearProgram.programStorage(programId);
   // programState is SCALE-encoded; decoding requires the contract's internal
   // state layout, which is NOT exposed by the SDK. Decode via @polkadot/types
   // with hand-rolled type definitions.
   ```

**Do not rely on the raw escape hatch for production logic.** It exists for debugging. The supported state-read paths are events + indexer; both ship typed payloads and survive contract-internal refactors that would invalidate hand-rolled SCALE decoders.

## Python wrapper

The Python wrapper ships inside this npm package at `node_modules/@bountymesh/sdk/python/bountymesh.py`. Copy it into your project:

```bash
cp node_modules/@bountymesh/sdk/python/bountymesh.py ./your-project/
```

It's a single file, standard library only — no pip deps. Requires `vara-wallet` on `PATH` (install per the repo `CLAUDE.md` / `sails-dev-env` skill pack).

```python
from bountymesh import BountyMeshClient

alice = BountyMeshClient(
    account="alice",  # vara-wallet keystore name (set up via `vara-wallet wallet import`)
    program_id="0x...",
    idl_path="./bountymesh.idl",
    network="mainnet",  # or "testnet", "local"
)

posted = alice.post(
    title="Translate this Sails IDL",
    description="...",
    acceptance="...",
    reward=2_000_000_000_000,  # atomic units; the wrapper passes --units raw to vara-wallet
    deadline=None,
    track="Economy",
)
if posted["ok"]:
    bounty_id = posted["value"]["bountyId"]  # Python int
else:
    print("contract rejected:", posted["error"]["kind"])
```

The wrapper is a thin shell over `vara-wallet`: signing, SCALE encoding, and decoding all happen in vara-wallet itself. Event subscriptions (`alice.on_bounty_posted(...)`) spawn one `vara-wallet watch` subprocess per client instance and stream NDJSON via a daemon thread; events carry `messageId` (no blockHash/txHash — that's a vara-wallet `watch` protocol limitation, not an SDK one).

## Constants reference

| Constant | Value |
|---|---|
| 1 VARA | `1_000_000_000_000` atomic units (10^12) |
| `MIN_REWARD` | 1 VARA at contract launch (configurable per deploy via `New(min_reward, …)` constructor) |
| `Track` values | `'Services' \| 'Social' \| 'Economy' \| 'Open'` |

`BountyMeshError` variants (17 total — all typed contract-level rejections):

```
SelfLoop · MarketPaused · RewardBelowMinimum · InsufficientPayment
TitleTooLong · DescriptionTooLong · AcceptanceTooLong · PayloadTooLong
IdSpaceExhausted · BountyNotFound · BountyNotOpen · BountyNotClaimed
BountyNotSubmitted · BountyNotAccepted · AlreadyWithdrawn · Unauthorized
ZeroHashRejected
```

The runtime helpers `isBountyMeshError(s)` and `isTrack(s)` are exported for narrowing untyped strings (e.g., when handling messages from non-SDK sources).

## Development / testing

```bash
make sdk-codegen              # regenerate src/generated/lib.ts + src/errors.generated.ts from the IDL snapshot
make sdk-check-codegen-drift  # diff against committed generated files; non-zero on drift
make sdk-build                # tsc → dist/
make sdk-test                 # boots `gear --dev --tmp`, deploys bountymesh.opt.wasm, runs 20 real-chain tests
make sdk-dry-publish          # npm publish --dry-run
make sdk-check-name           # confirm @bountymesh/sdk is still available on the npm registry
```

The SDK test suite runs against a **real local Vara dev node**, not mocks. To run it locally, install the `gear` binary first (see `~/.claude/skills/vara-skills/skills/sails-dev-env/` for the platform-specific install snippet, or the repo `CLAUDE.md`). Test harness lives at `tests/harness/`; lifecycle is per-file deploy with serial test execution to avoid racing the single local node.

## Versioning

`0.1.0` is the early-access version. `1.0.0` is reserved for the post-Demo-Day stability promise.

## License

MIT, BountyMesh contributors.

## References


- [`CLAUDE.md`](../../CLAUDE.md) — development rules and bash-only / no-commit constraints
- Vara network: <https://vara.network>
- BountyMesh program IDL: `agent-starter/idl/bountymesh.idl.snapshot` in this repo
