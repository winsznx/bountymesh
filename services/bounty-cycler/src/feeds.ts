/**
 * bountymesh-feeds caller — signals hiring demand via PostBoosted before
 * the cycler posts a real bounty to bountymesh. Generates an extra
 * on-chain interaction per cycle (cycler → feeds, separate from
 * cycler → bountymesh) so feeds accumulates real integrationsIn traffic.
 *
 * Loads sails-js + sails-js-parser dynamically and parses the IDL at
 * boot. The contract refunds any attached value on its reply — we
 * attach zero, so this is gas-only spend (~0.05 VARA per call).
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { GearApi } from '@gear-js/api';
import type { KeyringPair } from '@polkadot/keyring/types';
import { Sails } from 'sails-js';
import { SailsIdlParser } from 'sails-js-parser';
import type { Track } from '@bountymesh/sdk';

const FEEDS_PROGRAM_ID =
  '0x2b4b42db048f922d8da9db2dd1d0f93ef4978a7f05eaabf1892bca7fac340ab2' as `0x${string}`;

export type Multiplier = 5_000 | 8_000 | 10_000 | 12_000 | 15_000 | 20_000;

export const MULTIPLIER_ROTATION: Multiplier[] = [8_000, 10_000, 12_000, 15_000];

function loadFeedsIdl(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', 'bountymesh_feeds.idl'),
    join(here, 'bountymesh_feeds.idl'),
    '/app/bountymesh_feeds.idl',
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
  }
  throw new Error('bountymesh_feeds.idl not found on disk; bundle it next to dist/');
}

export async function buildFeedsSails(api: GearApi): Promise<Sails> {
  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(loadFeedsIdl());
  sails.setApi(api);
  sails.setProgramId(FEEDS_PROGRAM_ID);
  return sails;
}

export interface PostBoostedResult {
  effectiveAtomic: bigint;
  txHash: string;
  blockHash: string;
}

export async function postBoosted(
  sails: Sails,
  signer: KeyringPair,
  track: Track,
  baseRewardAtomic: bigint,
  multiplierBps: number,
): Promise<PostBoostedResult> {
  const tx = sails.services.FeedsService.functions.PostBoosted(
    { [track]: null },
    baseRewardAtomic,
    multiplierBps,
  );
  tx.withAccount(signer);
  await tx.calculateGas();
  const sent = await tx.signAndSend();
  const reply = (await sent.response()) as { ok?: bigint } | { err?: unknown };
  if ('ok' in reply && reply.ok !== undefined) {
    return {
      effectiveAtomic: reply.ok,
      txHash: String(sent.txHash),
      blockHash: String(sent.blockHash),
    };
  }
  throw new Error(`feeds.PostBoosted error: ${JSON.stringify(reply)}`);
}

export function pickMultiplier(cycleIndex: number): Multiplier {
  return MULTIPLIER_ROTATION[cycleIndex % MULTIPLIER_ROTATION.length];
}
