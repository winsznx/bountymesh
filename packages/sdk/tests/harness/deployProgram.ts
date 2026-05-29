import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GearApi } from '@gear-js/api';
import type { KeyringPair } from '@polkadot/keyring/types';
import { SailsProgram } from '../../src/generated/lib.js';
import type { HexString } from '@gear-js/api/types';

const SDK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WASM_PATH = resolve(
  SDK_DIR,
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
 * Verified against:
 *   - sails-js@0.5.1 transaction-builder.d.ts (newCtorFromCode signature)
 *   - src/generated/lib.ts (constructor args: min_reward, auto_settle_blocks)
 *   - vara-skills/skills/sails-local-smoke (preferred newCtorFromCode pattern)
 *   - sails-gtest-and-local-validation.md "JS/TS Deploy Pitfalls":
 *       * pass keyring pair directly to withAccount (no { signer: pair } wrapper)
 *       * use withGas('max') to avoid "Program has been terminated" on ctor OOG
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
