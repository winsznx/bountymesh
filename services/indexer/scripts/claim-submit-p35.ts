/**
 * P3.5 sample-data prep. Throwaway — delete after P3.10 close.
 *
 * Bob walks a Tim-posted bounty from Open → Claimed → Submitted, stopping
 * before Accept so Tim can drive the AcceptSubmissionButton flow in browser
 * for the P3.5 gate.
 *
 * Writes the canonical-JSON envelope to apps/web/public/envelopes/{id}.json
 * so EnvelopeViewer renders verified ✓ during the gate.
 *
 * Usage:
 *   BOUNTY_ID=18 tsx scripts/claim-submit-p35.ts
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
const BOUNTY_ID = BigInt(process.env.BOUNTY_ID ?? "18");

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENVELOPES_DIR = resolve(SCRIPT_DIR, "../../../apps/web/public/envelopes");

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",") + "}";
  }
  throw new Error(`unsupported value type: ${typeof value}`);
}

function sha256Hex(input: string): `0x${string}` {
  return `0x${createHash("sha256").update(input, "utf-8").digest("hex")}` as `0x${string}`;
}

const OUTPUT = `# Worker deliverable for bounty #${BOUNTY_ID.toString()}

This is the simulated worker output for the P3.5 accept-flow demo.

## What was done
- Read the bounty's acceptance criteria
- Produced a deliverable matching them
- Hashed the canonical envelope
- Submitted on-chain via Submit(bountyId, payload, hash)

## Reviewer notes
The poster (you, in the browser) should now see the AcceptSubmissionButton
mounted in the bounty detail page above the timeline. Clicking it opens
the inline confirmation panel; confirming triggers the on-chain Accept tx.
Once finalized, the timeline lights the Accepted stage in emerald, the
button unmounts, and the worker is unblocked to Withdraw the escrowed
reward.

## Cycle close
After Withdraw, the bounty terminates in Withdrawn state. The full
lifecycle is recorded on-chain and projected by the indexer; this static
envelope file pairs with the on-chain resultHash for envelope verification
in the EnvelopeViewer component.`;

async function main(): Promise<void> {
  console.log(`[p35] connecting to ${WS_URL}`);
  await cryptoWaitReady();
  const api = await GearApi.create({ providerAddress: WS_URL });

  const keyring = new Keyring({ type: "sr25519" });
  const bob = keyring.addFromUri("//Bob");
  const bobHex = `0x${Buffer.from(bob.publicKey).toString("hex")}` as `0x${string}`;
  console.log(`[p35] bob = ${bob.address}`);
  console.log(`[p35] target program: ${PROGRAM_ID}`);
  console.log(`[p35] target bounty:  #${BOUNTY_ID.toString()}`);

  const bobClient = new BountyMeshClient({
    api,
    programId: PROGRAM_ID as `0x${string}`,
    signer: bob,
  });

  console.log(`[p35] bob.claim(${BOUNTY_ID})`);
  const c = await bobClient.claim(BOUNTY_ID);
  if (!c.ok) throw new Error(`claim failed: ${c.error}`);

  const head = (await api.rpc.chain.getHeader()).number.toNumber();
  const envelope: Record<string, unknown> = {
    v: 1,
    task: BOUNTY_ID.toString(),
    worker: bobHex,
    produced_at: head,
    output_inline: OUTPUT,
    output_blob_url: null,
    output_blob_sha256: null,
    upstream: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      request_canonical: {
        bounty_id: BOUNTY_ID.toString(),
        prompt: "Produce the deliverable matching the bounty's acceptance criteria.",
        max_tokens: 1024,
        temperature: 0,
      },
      response_sha256: sha256Hex(OUTPUT),
      response_body_inline: OUTPUT,
      attempts: 1,
      request_at: new Date(Date.now() - 12_000).toISOString(),
      response_at: new Date(Date.now() - 200).toISOString(),
      error: null,
    },
    reproducibility: "best-effort",
    provider_determinism: "temp-0-bounded",
    crash_resumed: false,
  };
  const canonical = canonicalJson(envelope);
  const resultHash = sha256Hex(canonical);
  console.log(`[p35] envelope built: ${canonical.length} bytes, resultHash=${resultHash}`);
  if (canonical.length > 5000) throw new Error(`envelope too long: ${canonical.length}`);

  console.log(`[p35] bob.submit(${BOUNTY_ID})`);
  const s = await bobClient.submit(BOUNTY_ID, canonical, resultHash);
  if (!s.ok) throw new Error(`submit failed: ${s.error}`);

  mkdirSync(ENVELOPES_DIR, { recursive: true });
  writeFileSync(resolve(ENVELOPES_DIR, `${BOUNTY_ID.toString()}.json`), canonical, "utf-8");
  console.log(`[p35] wrote envelopes/${BOUNTY_ID.toString()}.json`);

  console.log(`[p35] done — #${BOUNTY_ID.toString()} is Submitted; poster's turn`);
  await api.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
