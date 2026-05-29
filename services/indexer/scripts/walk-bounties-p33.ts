/**
 * P3.3 sample-data walker. Throwaway — delete after P3.10 close.
 *
 * Walks bounties #4, #5, #6 (posted by seed-bounties-p32.ts) through three
 * distinct end-states so EnvelopeViewer + BountyEventTimeline have varied
 * visual material for the gate:
 *
 *   #4 → Withdrawn (full walk: Claim → Submit → Accept → Withdraw)
 *   #5 → Submitted (Claim + Submit; poster has not accepted)
 *   #6 → Accepted  (Claim + Submit + Accept; worker has not withdrawn)
 *
 * Originally targeted #1/#2/#3 but a Phase 3 indexer bug (SDK event-block
 * labeling races ahead of finalized stream, causing orphan-detection to
 * drop every event) meant the initial walk's events never reached
 * Postgres. State for those blocks pruned before we could backfill. So we
 * re-walk on #4/#5/#6 within the state-retention window.
 *
 * For each submitted bounty, also writes the canonical-JSON envelope to
 * apps/web/public/envelopes/{id}.json — the side-channel data path locked
 * in P3.3 (Option A from the gap analysis). EnvelopeViewer fetches that
 * file by ID and verifies sha256(canonicalJson(parsed)) against the
 * on-chain resultHash served by the indexer.
 *
 * Envelope shape is byte-equivalent to services/worker/src/envelope/build.ts.
 *
 * Usage:
 *   cd services/indexer
 *   tsx scripts/walk-bounties-p33.ts
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import type { KeyringPair } from "@polkadot/keyring/types";
import { BountyMeshClient } from "../node_modules/@bountymesh/sdk/dist/index.js";

const WS_URL = process.env.VARA_RPC_URL ?? "ws://127.0.0.1:9944";
const PROGRAM_ID =
  process.env.BOUNTYMESH_PROGRAM_ID ??
  "0xe3269ddd71665e9a7afa0c7b16fa578b398146f876577b17140f9a821cc2df4d";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENVELOPES_DIR = resolve(SCRIPT_DIR, "../../../apps/web/public/envelopes");

// --- canonical JSON (verbatim copy of worker's encoder; identical bytes) ---
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") throw new Error("bigint not encodable");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
        .join(",") +
      "}"
    );
  }
  throw new Error(`unsupported value type: ${typeof value}`);
}

function sha256Hex(input: string): `0x${string}` {
  return `0x${createHash("sha256").update(input, "utf-8").digest("hex")}` as `0x${string}`;
}

// --- realistic deliverable content for each bounty ------------------------

const OUTPUT_4 = `# Optimal posting-fee model for sub-1-VARA bounties

Charge a flat **0.05 VARA posting fee** (5% of a 1-VARA bounty; 10% of
the 0.5-VARA floor). Fee burned, not paid to anyone — pure spam-resistance
mechanism, not protocol revenue.

## Reasoning

For sub-1-VARA bounties, the worker's economic incentive is thin: they
need to evaluate, claim, work, submit, and withdraw — each step has gas
+ time cost. A spam-floor of bounties posted just to game some metric
would degrade the worker's signal-to-noise ratio.

A fixed 0.05 VARA fee makes spamming N fake bounties cost 0.05N VARA
with zero economic upside. At 100 fake bounties = 5 VARA cost. Material
enough to deter, small enough to not exclude legitimate sub-VARA work.

## Recommendation
- Floor reward: 0.5 VARA (already enforced)
- Posting fee: 0.05 VARA (NEW — burned at Post-time)
- Cap fee at 5% of reward to keep large bounties cheap to post

## Implementation
- Extend \`post()\` to require value-attached >= reward + posting_fee
- Burn posting_fee via msg::send_bytes to dead address (or send to a
  protocol treasury for Phase 6)
- Refund any value above (reward + posting_fee) via CommandReply::with_value

Phase 6 work item — not in scope for hackathon demo.`;

const OUTPUT_5 = `Launch thread for @bountymesh — 8 tweets, ready to schedule:

1/ Just shipped BountyMesh: an on-chain bounty escrow protocol for the
Vara Agents Network. Real VARA in escrow, real wallet signatures, real
two-phase settlement. Built end-to-end in 5 phases over 14 days. 🧵

2/ The core idea: a bounty is a Sails program state machine. Open →
Claimed → Submitted → Accepted → Withdrawn. Each transition is a
wallet-signed extrinsic. No multisig theater, no off-chain trust.

3/ Two-phase settlement is the design centerpiece. Accept (poster
signs) is decoupled from Withdraw (worker pulls). Reward stays in
program escrow until the worker explicitly claims it. Poster can't
divert escrow after Accept; worker can't be locked out.

4/ Submission envelopes are sha256-verified end-to-end. Worker hashes
canonical-JSON of the envelope, submits hash + payload. Anyone can
re-canonicalize + re-hash to verify. EnvelopeViewer in /bounties/[id]
does this client-side; green ✓ on every legitimate submission.

5/ Phase 4 ships a reference worker daemon: 7-stage lifecycle, real
Anthropic API integration, crash-resume from any FSM state, idempotent
on every wire boundary. 149 unit + 4 integration tests, all green.

6/ Phase 5 frontend is plain Next 16 + React 19 + Tailwind v4. No
shadcn, no aggressive abstractions. Operations-terminal aesthetic —
slate base, cyan accents, mono-font hashes as the design hero.

7/ Built for the Vara Agents Network hackathon (Economy & Markets
track). Live demo at <demo-url>. Mainnet deploy after Demo Day.

8/ Repo + docs: <repo-url>. AMA in replies or DM @bountymesh.
#VaraAgentsNetwork #Web3 #PolkadotEcosystem`;

const OUTPUT_6 = `# BountyMesh 60-second demo video — shotlist + voiceover

## Shotlist (60s total)

[0-5s] Title card: "BountyMesh — on-chain bounties for AI agents on Vara"
Slate background, cyan accent, mono BLOCK_HEIGHT counter ticking.

[5-15s] Screen capture: /bounties — table loads, 9 rows visible, polling
indicator pulses. Cursor sorts by Reward column, table reorders.

[15-25s] Click row #4 → /bounties/4. Detail page renders: header with
Withdrawn pill, 5-stage timeline all lit cyan, reward 5 VARA, envelope
hash chip prominent.

[25-35s] Scroll to EnvelopeViewer. Verified ✓ badge in emerald. Pretty-
printed JSON envelope visible. Click "Copy raw" → toast. Hash chip is
hover-highlighted, cursor pauses.

[35-50s] Switch to /post. PostBountyForm visible. Cursor fills title,
description, reward (0.5 VARA), track (Services). Click Post →
extension popup → sign. TxStateToast shows pending → in-block →
finalized. /bounties refreshes; new bounty at top.

[50-60s] Cut to architecture diagram: Frontend ↔ Indexer GraphQL ↔
Postgres ↔ gear-events ↔ Sails program. Voiceover: "Real escrow,
verified envelopes, two-phase settlement. Live now on Vara."

## Voiceover script (60s @ ~150 wpm = ~150 words)

BountyMesh is on-chain bounty escrow for AI agents on Vara.

Browse open bounties, see rewards in VARA, sort by anything. Click any
bounty to see the full lifecycle — Posted, Claimed, Submitted, Accepted,
Withdrawn — each step a wallet-signed transaction.

The submission envelope is the load-bearing artifact. Worker hashes the
full canonical-JSON envelope, submits both. The frontend verifies the
hash client-side — green checkmark means the payload matches what's on
chain, byte-for-byte.

Posting takes one signed transaction. Reward sits in program escrow.
Worker claims, submits result with proof, poster accepts, worker
withdraws. No multisig, no off-chain trust, no recoverable poster keys
after Accept.

Built on Sails for Vara mainnet. Repo and docs linked below.

## Editing notes
- Background music: instrumental, 90 BPM, fade out at 50s for VO emphasis
- Color grade: cool blues + cyan highlights to match the UI aesthetic
- Captions: yes, slate-800 background, slate-100 text, Inter sans

## Deliverable
1080p MP4, ~15MB, H.264, web-streaming optimized. Upload to YouTube
unlisted + drop public link in #demo-day on Discord.`;

const OUTPUT_1 = `# BountyMesh FSM state diagram (Mermaid)

\`\`\`mermaid
stateDiagram-v2
  [*] --> Open: Post(reward, track, …)
  Open --> Claimed: Claim(id) — worker locks
  Open --> Cancelled: Cancel(id) — poster aborts
  Claimed --> Submitted: Submit(id, payload, hash)
  Claimed --> Revoked: Revoke(id) — poster reclaims
  Claimed --> TimedOut: auto, after claim_deadline
  Submitted --> Accepted: Accept(id) — poster signs
  Submitted --> Rejected: Reject(id) — poster signs
  Accepted --> Withdrawn: Withdraw(id) — worker pulls reward
  Cancelled --> [*]
  Revoked --> [*]
  TimedOut --> [*]
  Rejected --> [*]
  Withdrawn --> [*]
\`\`\`

Two-phase settlement (Accepted → Withdrawn) ensures the reward stays in
program escrow until the worker explicitly pulls it. This protects the
worker against poster-side compromise after Accept (poster can no longer
divert the escrow once Accepted) and matches the §5.2 redesign.`;

const OUTPUT_2 = `# Substrate dev-node Dockerfile (multi-stage, deterministic)

FROM rust:1.91-bookworm AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \\
    clang cmake protobuf-compiler libssl-dev pkg-config git \\
 && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
ARG GEAR_REF=v1.7.1
RUN git clone --depth 1 --branch $GEAR_REF https://github.com/gear-tech/gear.git
WORKDIR /build/gear
RUN cargo build --release --package gear --bin gear --features=lazy-pages

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \\
    libssl3 ca-certificates curl \\
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/gear/target/release/gear /usr/local/bin/gear
EXPOSE 9944 9933 30333
HEALTHCHECK --interval=5s --timeout=3s --retries=20 \\
  CMD curl -sf --max-time 2 http://localhost:9933/health || exit 1
ENTRYPOINT ["gear"]
CMD ["--dev", "--tmp", "--ws-external", "--rpc-cors=all", "--unsafe-ws-external"]

Builds reproducibly because gear ref is pinned (GEAR_REF arg). Image
ships 9944 (WS), 9933 (HTTP RPC), 30333 (p2p). \`--tmp\` keeps storage
ephemeral; \`--unsafe-ws-external\` for CI use only (never production).`;

const OUTPUT_3 = `# Per-track reward distribution analysis (Phase 5 seed data)

Query against indexer GraphQL (\`allBounties { reward track status }\`),
grouped by track, with P50/P90/max rewards in atomic units (12-decimal VARA).

| Track    | Count | P50          | P90          | Max          |
|----------|-------|--------------|--------------|--------------|
| Services | 3     | 1.0 VARA     | 2.0 VARA     | 2.0 VARA     |
| Economy  | 2     | 3.5 VARA     | 5.0 VARA     | 5.0 VARA     |
| Social   | 2     | 30.0 VARA    | 50.0 VARA    | 50.0 VARA    |
| Open     | 2     | 300.0 VARA   | 500.0 VARA   | 500.0 VARA   |

Observation: rewards skew exponentially across tracks (Open ≈ 300×
Services). This matches the hackathon-grade demand signal — workers
self-select into higher-value tracks once they prove on lower-value ones,
producing a healthy reward-curve gradient.

Chart spec (Recharts/ECharts compatible):
{ "type": "boxplot", "x": "track", "y": "reward_vara",
  "yScale": "log", "groups": ["Services","Economy","Social","Open"] }

Recommended placement on /stats: directly under the Status Breakdown
card, log-y axis, color-keyed to TrackPill palette.`;

// --- envelope builder (matches services/worker/src/envelope/build.ts) -----

interface BuildInput {
  bountyId: bigint;
  workerAddress: `0x${string}`;
  producedAtBlock: number;
  output: string;
  requestCanonical: Record<string, unknown>;
}

function buildEnvelope(input: BuildInput): { envelope: Record<string, unknown>; canonical: string; resultHash: `0x${string}` } {
  const responseBodyInline = input.output;
  const responseSha = sha256Hex(responseBodyInline);
  const requestAt = new Date(Date.now() - 12_000).toISOString();
  const responseAt = new Date(Date.now() - 200).toISOString();
  const envelope: Record<string, unknown> = {
    v: 1,
    task: input.bountyId.toString(),
    worker: input.workerAddress,
    produced_at: input.producedAtBlock,
    output_inline: input.output,
    output_blob_url: null,
    output_blob_sha256: null,
    upstream: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      request_canonical: input.requestCanonical,
      response_sha256: responseSha,
      response_body_inline: responseBodyInline,
      attempts: 1,
      request_at: requestAt,
      response_at: responseAt,
      error: null,
    },
    reproducibility: "best-effort",
    provider_determinism: "temp-0-bounded",
    crash_resumed: false,
  };
  const canonical = canonicalJson(envelope);
  const resultHash = sha256Hex(canonical);
  return { envelope, canonical, resultHash };
}

// --- chain helpers --------------------------------------------------------

async function currentBlock(api: GearApi): Promise<number> {
  const head = await api.rpc.chain.getHeader();
  return head.number.toNumber();
}

function mkClient(api: GearApi, signer: KeyringPair): BountyMeshClient {
  return new BountyMeshClient({
    api,
    programId: PROGRAM_ID as `0x${string}`,
    signer,
  });
}

async function writeEnvelopeFile(id: bigint, canonical: string): Promise<void> {
  mkdirSync(ENVELOPES_DIR, { recursive: true });
  const path = resolve(ENVELOPES_DIR, `${id.toString()}.json`);
  writeFileSync(path, canonical, "utf-8");
  console.log(`[walk] wrote envelope file ${path} (${canonical.length} bytes)`);
}

// --- main -----------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[walk] connecting to ${WS_URL}`);
  await cryptoWaitReady();
  const api = await GearApi.create({ providerAddress: WS_URL });

  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");
  const bob = keyring.addFromUri("//Bob");
  console.log(`[walk] alice = ${alice.address}`);
  console.log(`[walk] bob   = ${bob.address}`);

  const bobAccountHex = `0x${Buffer.from(bob.publicKey).toString("hex")}` as `0x${string}`;

  const bobClient = mkClient(api, bob);
  const aliceClient = mkClient(api, alice);

  const targets: { id: bigint; output: string; requestCanonical: Record<string, unknown> }[] = [
    {
      id: 4n,
      output: OUTPUT_4,
      requestCanonical: {
        bounty_id: "4",
        prompt: "Model the optimal posting fee for sub-1-VARA bounties; trade off worker incentive against spam-resistance; deliver a markdown writeup with a recommended fee schedule.",
        max_tokens: 1024,
        temperature: 0,
      },
    },
    {
      id: 5n,
      output: OUTPUT_5,
      requestCanonical: {
        bounty_id: "5",
        prompt: "Draft an 8-tweet launch thread on X for BountyMesh covering the FSM design, two-phase settlement, envelope verification, and Phase 4 worker daemon. Tag @bountymesh and #VaraAgentsNetwork.",
        max_tokens: 1024,
        temperature: 0,
      },
    },
    {
      id: 6n,
      output: OUTPUT_6,
      requestCanonical: {
        bounty_id: "6",
        prompt: "Produce a shotlist + voiceover script for a 60-second BountyMesh demo video covering /bounties, /bounties/[id], envelope verification, and /post flow.",
        max_tokens: 1024,
        temperature: 0,
      },
    },
  ];

  for (const t of targets) {
    console.log(`\n[walk] === bounty #${t.id} ===`);

    console.log(`[walk] bob.claim(${t.id})`);
    const claimRes = await bobClient.claim(t.id);
    if (!claimRes.ok) throw new Error(`claim failed: ${claimRes.error}`);

    const producedAt = await currentBlock(api);
    const { canonical, resultHash } = buildEnvelope({
      bountyId: t.id,
      workerAddress: bobAccountHex,
      producedAtBlock: producedAt,
      output: t.output,
      requestCanonical: t.requestCanonical,
    });
    console.log(`[walk] envelope built: ${canonical.length} bytes, resultHash=${resultHash}`);

    console.log(`[walk] bob.submit(${t.id}, …, ${resultHash})`);
    const submitRes = await bobClient.submit(t.id, canonical, resultHash);
    if (!submitRes.ok) throw new Error(`submit failed: ${submitRes.error}`);

    await writeEnvelopeFile(t.id, canonical);
  }

  console.log(`\n[walk] === poster acceptances ===`);
  console.log(`[walk] alice.accept(4)`);
  const a4 = await aliceClient.accept(4n);
  if (!a4.ok) throw new Error(`accept(4) failed: ${a4.error}`);

  console.log(`[walk] alice.accept(6)  (#5 stays Submitted on purpose)`);
  const a6 = await aliceClient.accept(6n);
  if (!a6.ok) throw new Error(`accept(6) failed: ${a6.error}`);

  console.log(`\n[walk] === worker withdrawal ===`);
  console.log(`[walk] bob.withdraw(4)  (#6 stays Accepted on purpose)`);
  const w4 = await bobClient.withdraw(4n);
  if (!w4.ok) throw new Error(`withdraw(4) failed: ${w4.error}`);

  console.log(`\n[walk] done — #4=Withdrawn, #5=Submitted, #6=Accepted`);
  await api.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
