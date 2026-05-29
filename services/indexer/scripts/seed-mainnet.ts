/**
 * P5 mainnet seed — 3 OPEN bounties posted from the winsznx wallet against
 * the BountyMesh program on Vara mainnet. Throwaway demo data; conservative
 * spend (~2 VARA in rewards + gas).
 *
 * Usage:
 *   cd services/indexer
 *   tsx scripts/seed-mainnet.ts
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { BountyMeshClient } from "../node_modules/@bountymesh/sdk/dist/index.js";

const WS_URL = "wss://rpc.vara.network";
const PROGRAM_ID =
  "0xfa09abea4ac2de874bc115cfcfd0992e07636ee9f74e62a21b3750fd6f218886";
const KEYSTORE_PATH = resolve(homedir(), ".vara-wallet/wallets/winsznx.json");

const VARA = 1_000_000_000_000n;

type Track = "Services" | "Economy" | "Social" | "Open";

interface Seed {
  title: string;
  description: string;
  acceptance: string;
  reward: bigint;
  track: Track;
}

const SEEDS: Seed[] = [
  {
    title: "Write a 30-second Vara introduction tweet",
    description:
      "Produce a single tweet (≤280 chars) explaining what Vara A2A is to a crypto-native audience. No emoji. Should land the core: agents on Vara, on-chain coordination, contract-enforced settlement.",
    acceptance:
      "Tweet posted from a verified X account, link submitted as payload, mentions @VaraNetwork.",
    reward: VARA / 2n,
    track: "Services",
  },
  {
    title: "Audit BountyMesh's anti-cheat against self-loop edge cases",
    description:
      "Read programs/bountymesh/app/src/service.rs at github.com/winsznx/bountymesh; identify any path where self-loop reject could be bypassed. Report what you find, even if the answer is 'no bypass exists, here is why'.",
    acceptance:
      "Submit a markdown audit with line-references to the Vara agent-paid-service.md anti-cheat spec.",
    reward: VARA,
    track: "Economy",
  },
  {
    title: "Submit a clean Loom recording of the BountyMesh flow",
    description:
      "Record yourself walking through bountymesh.xyz: connect wallet, post a bounty, observe the live indexer pick it up. 60-second demo.",
    acceptance:
      "Loom link submitted as payload, demo lifecycle visible end-to-end (post -> /bounties row appears).",
    reward: VARA / 2n,
    track: "Open",
  },
];

async function main(): Promise<void> {
  console.log(`[seed-mainnet] connecting to ${WS_URL}`);
  await cryptoWaitReady();
  const api = await GearApi.create({ providerAddress: WS_URL });

  // Load winsznx wallet keystore (unencrypted per --no-encrypt at create)
  const keystoreRaw = readFileSync(KEYSTORE_PATH, "utf-8");
  const keystore = JSON.parse(keystoreRaw) as Record<string, unknown>;
  const keyring = new Keyring({ type: "sr25519" });
  const signer = keyring.addFromJson(keystore as never);
  signer.unlock("");
  console.log(`[seed-mainnet] signer: winsznx (${signer.address})`);
  console.log(`[seed-mainnet] target program: ${PROGRAM_ID}`);

  const client = new BountyMeshClient({
    api,
    programId: PROGRAM_ID as `0x${string}`,
    signer,
  });

  let posted = 0;
  let failed = 0;
  const ids: bigint[] = [];

  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i]!;
    console.log(`\n[seed-mainnet] ${i + 1}/${SEEDS.length} (${s.track}, ${Number(s.reward) / Number(VARA)} VARA): "${s.title}"`);
    try {
      const result = await client.post({
        title: s.title,
        description: s.description,
        acceptance: s.acceptance,
        reward: s.reward,
        track: s.track,
      });
      if (!result.ok) {
        console.error(`  FAILED: ${result.error}`);
        failed += 1;
        continue;
      }
      console.log(`  posted bountyId=${result.value.bountyId}`);
      console.log(`  txHash:    ${result.txHash}`);
      console.log(`  blockHash: ${result.blockHash}`);
      ids.push(result.value.bountyId);
      posted += 1;
    } catch (e) {
      console.error(`  EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
      failed += 1;
    }
  }

  console.log(`\n[seed-mainnet] done: ${posted} posted, ${failed} failed`);
  console.log(`[seed-mainnet] bounty ids: ${ids.map((x) => x.toString()).join(", ")}`);
  console.log(`[seed-mainnet] verify on Subscan:`);
  for (const id of ids) {
    console.log(`  https://vara.subscan.io/account/${PROGRAM_ID}`);
  }
  await api.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
