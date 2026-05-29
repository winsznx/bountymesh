import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GearApi } from '@gear-js/api';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { HexString } from '@gear-js/api/types';
// SDK's compiled SailsProgram. Imported via the literal node_modules path
// because the SDK's package.json exports map only exposes `.` — deep imports
// through the package name (e.g. `@bountymesh/sdk/generated`) are blocked by
// Node ESM resolution.
//
// The npm v10+ `file:` install symlinks @bountymesh/sdk to
// packages/sdk/, so this literal path resolves to packages/sdk/dist/generated/
// lib.js. Long-term resolution: add a "./generated" subpath export to
// packages/sdk/package.json.
import { SailsProgram } from '../../node_modules/@bountymesh/sdk/dist/generated/lib.js';

const INDEXER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WASM_PATH = resolve(
  INDEXER_DIR,
  '../../programs/bountymesh/target/wasm32-gear/release/bountymesh.opt.wasm',
);

export interface DeployParams {
  minReward: bigint;
  autoSettleBlocks: number;
}

export interface DeployedProgram {
  programId: HexString;
  program: SailsProgram;
}

/**
 * Uploads bountymesh.opt.wasm + invokes the New constructor in one tx.
 *
 * Mirror of packages/sdk/tests/harness/deployProgram.ts — differs ONLY in the
 * SailsProgram import path (see top-of-file comment).
 */
export async function deployBountyMesh(
  api: GearApi,
  signer: KeyringPair,
  params: DeployParams,
): Promise<DeployedProgram> {
  const code = readFileSync(WASM_PATH);
  const program = new SailsProgram(api);
  const tx = program
    .newCtorFromCode(code, params.minReward, params.autoSettleBlocks)
    .withAccount(signer)
    .withGas('max');
  const sent = await tx.signAndSend();
  await sent.response();
  return { programId: program.programId, program };
}
