/**
 * P3.2 sample-data seeder. Throwaway — delete after P3.10 close.
 *
 * Posts 8 OPEN bounties varied across the 4 tracks (Services / Economy /
 * Social / Open) and varied reward magnitudes (0.5 / 1 / 2 / 5 / 10 / 50 /
 * 100 / 500 VARA atomic) so the /bounties table has visual variety for the
 * P3.2 gate.
 *
 * Usage:
 *   cd services/indexer
 *   BOUNTYMESH_PROGRAM_ID=0x... tsx scripts/seed-bounties-p32.ts
 *
 * Reuses the Day 0 deploy by default; pass BOUNTYMESH_PROGRAM_ID to override.
 */

import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { BountyMeshClient } from "../node_modules/@bountymesh/sdk/dist/index.js";

const WS_URL = process.env.VARA_RPC_URL ?? "ws://127.0.0.1:9944";
const PROGRAM_ID =
  process.env.BOUNTYMESH_PROGRAM_ID ??
  "0xe3269ddd71665e9a7afa0c7b16fa578b398146f876577b17140f9a821cc2df4d";

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
    title: "Refactor the bounty FSM state diagram",
    description: "Update the SVG in docs/ to reflect the two-phase settlement.",
    acceptance: "PR opened + diagram embedded in README.",
    reward: VARA / 2n,
    track: "Services",
  },
  {
    title: "Write a Substrate dev-node Dockerfile",
    description: "Minimal image for CI use with deterministic state seeding.",
    acceptance: "Image builds; `docker run` exposes ws://localhost:9944.",
    reward: VARA,
    track: "Services",
  },
  {
    title: "Build a per-track reward distribution chart",
    description: "Render P50/P90/max reward by track from indexer GraphQL.",
    acceptance: "Chart deployed at /stats/rewards.",
    reward: 2n * VARA,
    track: "Economy",
  },
  {
    title: "Model the optimal posting fee for sub-1-VARA bounties",
    description: "Trade off worker incentive against spam-resistance.",
    acceptance: "Markdown writeup with a recommended fee schedule.",
    reward: 5n * VARA,
    track: "Economy",
  },
  {
    title: "Draft launch announcement thread on X",
    description: "8-tweet thread covering FSM, escrow safety, two-phase settlement.",
    acceptance: "Thread posted; link returned.",
    reward: 10n * VARA,
    track: "Social",
  },
  {
    title: "Record a 60-second BountyMesh demo video",
    description: "Voiceover walk-through of /bounties + /bounties/[id].",
    acceptance: "MP4 uploaded; link returned.",
    reward: 50n * VARA,
    track: "Social",
  },
  {
    title: "Implement Subscan event-decoder integration",
    description: "Patch Subscan's gear-event decoder to render BountyMesh events.",
    acceptance: "Subscan PR merged.",
    reward: 100n * VARA,
    track: "Open",
  },
  {
    title: "Port the BountyMeshClient to Python",
    description: "Sync API surface with the TypeScript SDK; tests against gear --dev.",
    acceptance: "PyPI package published with passing tests.",
    reward: 500n * VARA,
    track: "Open",
  },
];

async function main(): Promise<void> {
  console.log(`[seed] connecting to ${WS_URL}`);
  await cryptoWaitReady();
  const api = await GearApi.create({ providerAddress: WS_URL });

  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");
  console.log(`[seed] signer: //Alice (${alice.address})`);

  const client = new BountyMeshClient({
    api,
    programId: PROGRAM_ID as `0x${string}`,
    signer: alice,
  });
  console.log(`[seed] target program: ${PROGRAM_ID}`);

  let ok = 0;
  let err = 0;
  for (const [i, s] of SEEDS.entries()) {
    const label = `${i + 1}/${SEEDS.length} (${s.track}, ${(Number(s.reward) / Number(VARA)).toString()} VARA)`;
    try {
      const res = await client.post({
        title: s.title,
        description: s.description,
        acceptance: s.acceptance,
        reward: s.reward,
        track: s.track,
      });
      if (res.ok) {
        console.log(`[seed] ${label}: posted bountyId=${res.value.bountyId}`);
        ok++;
      } else {
        console.error(`[seed] ${label}: tx-level Err: ${res.error}`);
        err++;
      }
    } catch (e) {
      console.error(`[seed] ${label}: threw ${e instanceof Error ? e.message : String(e)}`);
      err++;
    }
  }

  console.log(`[seed] done: ${ok} posted, ${err} failed`);
  await api.disconnect();
  process.exit(err > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
