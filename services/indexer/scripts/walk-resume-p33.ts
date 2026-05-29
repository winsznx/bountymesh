/**
 * P3.3 walk-resume — picks up where walk-bounties-p33.ts left off after
 * the #6 submit hit PayloadTooLong (envelope was 5584 bytes, contract
 * MAX_RESULT_PAYLOAD_LEN = 5000). Trims OUTPUT_6, re-submits #6, runs
 * the remaining accept/withdraw chain. Throwaway — same lifetime as the
 * other p32/p33 scripts.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { BountyMeshClient } from "../node_modules/@bountymesh/sdk/dist/index.js";

const WS_URL = process.env.VARA_RPC_URL ?? "ws://127.0.0.1:9944";
const PROGRAM_ID =
  process.env.BOUNTYMESH_PROGRAM_ID ??
  "0xe3269ddd71665e9a7afa0c7b16fa578b398146f876577b17140f9a821cc2df4d";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENVELOPES_DIR = resolve(SCRIPT_DIR, "../../../apps/web/public/envelopes");

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
      keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",") +
      "}"
    );
  }
  throw new Error(`unsupported value type: ${typeof value}`);
}

function sha256Hex(input: string): `0x${string}` {
  return `0x${createHash("sha256").update(input, "utf-8").digest("hex")}` as `0x${string}`;
}

const OUTPUT_6_TRIMMED = `# BountyMesh 60-second demo video — shotlist + VO

## Shotlist (60s total)
[0-5s] Title: "BountyMesh — on-chain bounties for AI agents on Vara"
[5-15s] /bounties: table loads, 9 rows, sort by Reward column
[15-25s] /bounties/4: header Withdrawn pill, 5-stage timeline lit cyan
[25-35s] EnvelopeViewer: verified ✓ badge, JSON pretty-printed, Copy raw
[35-50s] /post: form filled, extension sign, TxStateToast progression
[50-60s] Architecture diagram: Frontend ↔ Indexer ↔ Postgres ↔ Sails

## Voiceover (~150 words / 60s @ 150wpm)
BountyMesh is on-chain bounty escrow for AI agents on Vara. Browse
open bounties, sort by anything. Click any to see the full lifecycle —
Posted, Claimed, Submitted, Accepted, Withdrawn — each step a
wallet-signed transaction. The submission envelope is the load-bearing
artifact: worker hashes canonical-JSON, submits both, frontend verifies
client-side. Green checkmark means the payload matches what's on chain
byte-for-byte. Posting takes one signed transaction. Reward sits in
program escrow. Worker claims, submits result with proof, poster
accepts, worker withdraws. No multisig, no off-chain trust. Built on
Sails for Vara mainnet. Repo and docs linked below.

## Editing notes
- BGM: instrumental, 90 BPM, fade at 50s for VO
- Grade: cool blues + cyan to match UI
- Captions: Inter sans, slate-100 on slate-800

## Deliverable
1080p MP4 ~15MB, H.264, web-streaming. YouTube unlisted, drop link
in #demo-day.`;

interface BuildInput {
  bountyId: bigint;
  workerAddress: `0x${string}`;
  producedAtBlock: number;
  output: string;
  requestCanonical: Record<string, unknown>;
}

function buildEnvelope(input: BuildInput): { canonical: string; resultHash: `0x${string}` } {
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
  return { canonical, resultHash };
}

async function main(): Promise<void> {
  console.log(`[resume] connecting to ${WS_URL}`);
  await cryptoWaitReady();
  const api = await GearApi.create({ providerAddress: WS_URL });
  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");
  const bob = keyring.addFromUri("//Bob");
  const bobAccountHex = `0x${Buffer.from(bob.publicKey).toString("hex")}` as `0x${string}`;
  const bobClient = new BountyMeshClient({ api, programId: PROGRAM_ID as `0x${string}`, signer: bob });
  const aliceClient = new BountyMeshClient({ api, programId: PROGRAM_ID as `0x${string}`, signer: alice });

  const head = (await api.rpc.chain.getHeader()).number.toNumber();
  const { canonical, resultHash } = buildEnvelope({
    bountyId: 6n,
    workerAddress: bobAccountHex,
    producedAtBlock: head,
    output: OUTPUT_6_TRIMMED,
    requestCanonical: {
      bounty_id: "6",
      prompt: "Produce a shotlist + voiceover script for a 60-second BountyMesh demo video covering /bounties, /bounties/[id], envelope verification, and /post flow.",
      max_tokens: 1024,
      temperature: 0,
    },
  });
  console.log(`[resume] #6 envelope: ${canonical.length} bytes, resultHash=${resultHash}`);
  if (canonical.length > 5000) throw new Error(`still too long: ${canonical.length}`);

  console.log(`[resume] bob.submit(6)`);
  const s6 = await bobClient.submit(6n, canonical, resultHash);
  if (!s6.ok) throw new Error(`submit(6) failed: ${s6.error}`);

  mkdirSync(ENVELOPES_DIR, { recursive: true });
  writeFileSync(resolve(ENVELOPES_DIR, "6.json"), canonical, "utf-8");
  console.log(`[resume] wrote envelopes/6.json (${canonical.length} bytes)`);

  console.log(`[resume] alice.accept(4)`);
  const a4 = await aliceClient.accept(4n);
  if (!a4.ok) throw new Error(`accept(4) failed: ${a4.error}`);

  console.log(`[resume] alice.accept(6)  (#5 stays Submitted)`);
  const a6 = await aliceClient.accept(6n);
  if (!a6.ok) throw new Error(`accept(6) failed: ${a6.error}`);

  console.log(`[resume] bob.withdraw(4)  (#6 stays Accepted)`);
  const w4 = await bobClient.withdraw(4n);
  if (!w4.ok) throw new Error(`withdraw(4) failed: ${w4.error}`);

  console.log(`[resume] done — #4=Withdrawn, #5=Submitted, #6=Accepted`);
  await api.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
