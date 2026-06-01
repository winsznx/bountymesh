/**
 * Cross-app on-chain calls fired from chat-poster each cycle.
 *
 * These calls intentionally generate signed extrinsics targeting other
 * Vara A2A registered Applications, so they accumulate as
 * `integrationsOutWalletInitiated` Interaction rows on the Vara A2A
 * indexer (one row per signed call, regardless of Ok/Err).
 *
 * Targets:
 *  - varabridge.GetPrice("VARA")        — function call, costs gas only
 *  - aan-tv.GetCoverageQueue            — read-only query, no Interaction row
 *  - aan-tv.RequestCoverage             — function call, 0.1 VARA value
 *                                         (refunded on Err; cost-bounded)
 *
 * IDLs are loaded from disk; the Dockerfile bundles the files next to
 * dist/. Sails clients are constructed once at process boot and reused.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { GearApi } from '@gear-js/api';
import type { KeyringPair } from '@polkadot/keyring/types';
import { Sails } from 'sails-js';
import { SailsIdlParser } from 'sails-js-parser';

export const VARABRIDGE_PROGRAM_ID =
  '0xfb7ed5a79dc2ff15283a524a4489321b5e1f6341db2b9892be83b9568cc1fcb4' as `0x${string}`;
export const AAN_TV_PROGRAM_ID =
  '0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f' as `0x${string}`;

const AAN_TV_COVERAGE_FEE_ATOMIC = 100_000_000_000n;

function loadIdl(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', filename),
    join(here, filename),
    join('/app', filename),
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
  }
  throw new Error(`${filename} not found on disk; bundle it next to dist/`);
}

export async function buildVaraBridgeSails(api: GearApi): Promise<Sails> {
  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(loadIdl('vara_bridge.idl'));
  sails.setApi(api);
  sails.setProgramId(VARABRIDGE_PROGRAM_ID);
  return sails;
}

export async function buildAanTvSails(api: GearApi): Promise<Sails> {
  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(loadIdl('aan_tv.idl'));
  sails.setApi(api);
  sails.setProgramId(AAN_TV_PROGRAM_ID);
  return sails;
}

export interface PriceFeed {
  symbol: string;
  price_usd_micro: bigint | number | string;
  change_24h_bps: number;
  market_cap_usd: bigint | number | string;
  volume_24h_usd: bigint | number | string;
  updated_at_block: number;
}

export interface VaraUsdRate {
  usd: number;
  change24hBps: number;
  txHash: string;
  blockHash: string;
}

/**
 * Signed call to varabridge.GetPrice("VARA"). Returns the parsed USD
 * rate (price_usd_micro / 1e6) plus the tx + block hash. Generates one
 * `integrationsOutWalletInitiated` Interaction row at varabridge.
 *
 * Cost: gas only (no value attached); ~0.001-0.01 VARA per call.
 */
export async function getVaraUsdRate(
  sails: Sails,
  signer: KeyringPair,
): Promise<VaraUsdRate | null> {
  try {
    const tx = sails.services.VaraBridge.functions.GetPrice('VARA');
    tx.withAccount(signer);
    await tx.calculateGas();
    const sent = await tx.signAndSend();
    const reply = (await sent.response()) as PriceFeed | null;
    if (!reply) return null;
    const micro = typeof reply.price_usd_micro === 'bigint'
      ? Number(reply.price_usd_micro)
      : Number(reply.price_usd_micro);
    return {
      usd: micro / 1_000_000,
      change24hBps: reply.change_24h_bps,
      txHash: String(sent.txHash),
      blockHash: String(sent.blockHash),
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export type CoverageKindVariant =
  | 'MarketResolved'
  | 'BountyCompleted'
  | 'LaunchedApp'
  | 'MatchSettled'
  | 'Custom';

export interface CoverageRequest {
  id: bigint | number | string;
  requester: string;
  event_kind: { [k in CoverageKindVariant]?: null };
  target_program: string | null;
  hint: string;
  paid: bigint | number | string;
  posted_at_block: number;
  chat_msg_id: bigint | number | string | null;
}

export interface CoverageQueuePage {
  items: CoverageRequest[];
  next_cursor: bigint | number | string | null;
}

/**
 * Read-only query against aan-tv.GetCoverageQueue. Returns up to
 * `limit` upcoming coverage entries. Does NOT generate an Interaction
 * row (queries are off-chain sims).
 */
export async function getAanTvCoverageQueue(
  sails: Sails,
  limit = 8,
): Promise<CoverageQueuePage | null> {
  try {
    const qb = sails.services.AanTv.queries.GetCoverageQueue(null, limit);
    const page = (await qb.atBlock(null).call()) as CoverageQueuePage | null;
    return page ?? null;
  } catch {
    return null;
  }
}

export interface RequestCoverageResult {
  coverageId: bigint;
  txHash: string;
  blockHash: string;
}

/**
 * Signed call to aan-tv.RequestCoverage with 0.1 VARA value attached
 * (the program's `coverage_fee`). Returns the coverage_id on Ok. On
 * Err, the value is refunded by the program via CommandReply::with_value,
 * but the Interaction row is still recorded.
 */
export async function requestAanTvCoverage(
  sails: Sails,
  signer: KeyringPair,
  eventKind: CoverageKindVariant,
  hint: string,
  targetProgram: `0x${string}` | null = null,
): Promise<RequestCoverageResult | null> {
  try {
    const kindArg = { [eventKind]: null } as { [k in CoverageKindVariant]?: null };
    const tx = sails.services.AanTv.functions.RequestCoverage(kindArg, targetProgram, hint);
    tx.withAccount(signer);
    tx.withValue(AAN_TV_COVERAGE_FEE_ATOMIC);
    await tx.calculateGas();
    const sent = await tx.signAndSend();
    const reply = (await sent.response()) as { ok?: bigint } | { err?: unknown };
    if ('ok' in reply && reply.ok !== undefined) {
      return {
        coverageId: reply.ok,
        txHash: String(sent.txHash),
        blockHash: String(sent.blockHash),
      };
    }
    throw new Error(`aan-tv RequestCoverage err: ${JSON.stringify(reply)}`);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}
