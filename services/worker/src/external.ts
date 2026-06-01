/**
 * External ecosystem hooks for the worker daemon.
 *
 * Two purely-additive side calls — neither perturbs claim/submit/withdraw
 * FSM logic. Both are best-effort: any failure (timeout / RPC error /
 * decode mismatch) resolves to null so the worker's main paths are not
 * affected.
 *
 * - getVaraUsdRate: signed extrinsic against @varabridge's VaraBridge/GetPrice
 *   (IDL declares GetPrice as a function, not a query — so it counts toward
 *   integrationsOutWalletInitiated). Rate-limited by the caller to ≤1/hour.
 * - getInfinitebountyOpen: read-only RPC sim against @infinite-bounty-v3's
 *   BountyBoard/GetBountiesByStatus (query — does NOT count for the metric
 *   but generates an operational visibility signal: the worker discovers
 *   external open bounties when its own claim queue is empty).
 *
 * Sails clients are cached per GearApi to avoid re-parsing the IDL each call.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { GearApi } from '@gear-js/api';
import type { KeyringPair } from '@polkadot/keyring/types';
import { Sails } from 'sails-js';
import { SailsIdlParser } from 'sails-js-parser';

const VARABRIDGE_PROGRAM_ID =
  '0xfb7ed5a79dc2ff15283a524a4489321b5e1f6341db2b9892be83b9568cc1fcb4' as `0x${string}`;
const INFINITE_BOUNTY_PROGRAM_ID =
  '0x747d09594538498f2c64ae91f93131a47b0ce8abaa80a54e37d7a6badadc15e8' as `0x${string}`;

const VARABRIDGE_IDL_NAME = 'vara_bridge.idl';
const INFINITE_BOUNTY_IDL_NAME = 'infinite_bounties.idl';

const EXTERNAL_TIMEOUT_MS = 10_000;

function loadIdl(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', filename),
    join(here, filename),
    `/app/${filename}`,
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
  }
  throw new Error(`${filename} not found next to dist/`);
}

let varaBridgeSailsPromise: Promise<Sails> | null = null;
let infiniteBountySailsPromise: Promise<Sails> | null = null;

async function getVaraBridgeSails(api: GearApi): Promise<Sails> {
  if (!varaBridgeSailsPromise) {
    varaBridgeSailsPromise = (async () => {
      const parser = await SailsIdlParser.new();
      const sails = new Sails(parser);
      sails.parseIdl(loadIdl(VARABRIDGE_IDL_NAME));
      sails.setApi(api);
      sails.setProgramId(VARABRIDGE_PROGRAM_ID);
      return sails;
    })();
  }
  return varaBridgeSailsPromise;
}

async function getInfiniteBountySails(api: GearApi): Promise<Sails> {
  if (!infiniteBountySailsPromise) {
    infiniteBountySailsPromise = (async () => {
      const parser = await SailsIdlParser.new();
      const sails = new Sails(parser);
      sails.parseIdl(loadIdl(INFINITE_BOUNTY_IDL_NAME));
      sails.setApi(api);
      sails.setProgramId(INFINITE_BOUNTY_PROGRAM_ID);
      return sails;
    })();
  }
  return infiniteBountySailsPromise;
}

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${tag} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export interface VaraUsdRate {
  usd: number;
  txHash: string;
  symbol: string;
}

interface PriceFeedRaw {
  symbol: string;
  price_usd_micro: bigint | number | string;
  change_24h_bps: number;
  market_cap_usd: bigint | number | string;
  volume_24h_usd: bigint | number | string;
  updated_at_block: number;
}

/**
 * Signed extrinsic against VaraBridge/GetPrice. Gas-only (no value attached).
 * Counts toward integrationsOutWalletInitiated. Returns null on any failure.
 */
export async function getVaraUsdRate(
  api: GearApi,
  signer: KeyringPair,
  symbol = 'VARA',
): Promise<VaraUsdRate | null> {
  try {
    const sails = await getVaraBridgeSails(api);
    const tx = sails.services.VaraBridge.functions.GetPrice(symbol);
    tx.withAccount(signer);
    await tx.calculateGas();
    const sent = await withTimeout(
      tx.signAndSend(),
      EXTERNAL_TIMEOUT_MS,
      'varabridge.GetPrice send',
    );
    const reply = (await withTimeout(
      sent.response(),
      EXTERNAL_TIMEOUT_MS,
      'varabridge.GetPrice reply',
    )) as PriceFeedRaw | null | undefined;
    if (!reply) return null;
    const priceMicro = BigInt(reply.price_usd_micro as string | number | bigint);
    const usd = Number(priceMicro) / 1_000_000;
    if (!Number.isFinite(usd) || usd <= 0) return null;
    return {
      usd,
      txHash: String(sent.txHash),
      symbol: reply.symbol ?? symbol,
    };
  } catch {
    return null;
  }
}

export interface InfiniteBountyOpenSummary {
  count: number;
  ids: string[];
}

interface InfiniteBountyRaw {
  id: bigint | number | string;
  creator: string;
  description: string;
  metadata_url: string;
  reward: bigint | number | string;
  status: unknown;
  claimant: string | null;
  proof_url: string | null;
  created_at: bigint | number | string;
}

interface InfiniteBountyPageRaw {
  bounties: InfiniteBountyRaw[];
}

/**
 * Read-only RPC sim against infinite-bounty-v3's GetBountiesByStatus(Open, …).
 * Does NOT count toward integrationsOutWalletInitiated (it's a query); used
 * as an operational signal that the worker is scanning the broader ecosystem
 * when its own claim queue is empty. Returns null on failure.
 */
export async function getInfinitebountyOpen(
  api: GearApi,
  limit = 10,
): Promise<InfiniteBountyOpenSummary | null> {
  try {
    const sails = await getInfiniteBountySails(api);
    const qb = sails.services.BountyBoard.queries.GetBountiesByStatus(
      { Open: null },
      null,
      limit,
    );
    const raw = (await withTimeout(
      qb.call(),
      EXTERNAL_TIMEOUT_MS,
      'infinite-bounty.GetBountiesByStatus',
    )) as InfiniteBountyPageRaw | null | undefined;
    if (!raw || !Array.isArray(raw.bounties)) return { count: 0, ids: [] };
    const ids = raw.bounties.map((b) => String(b.id));
    return { count: ids.length, ids };
  } catch {
    return null;
  }
}
