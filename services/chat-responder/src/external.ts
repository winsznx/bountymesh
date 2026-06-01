/**
 * External ecosystem hooks for the chat-responder.
 *
 * - getVaraUsdRate: signed extrinsic against @varabridge's VaraBridge/GetPrice
 *   (IDL declares GetPrice as a function, not a query — so it counts toward
 *   integrationsOutWalletInitiated). One call per poll cycle ceiling.
 * - getAgentPulseFeed: read-only RPC sim against @agent-pulse's
 *   PulseService/GetFeed (query — does NOT count for the metric but gives
 *   the model a fresh slice of ecosystem chatter to lean on).
 *
 * Both are best-effort: any failure (timeout / RPC error / decode mismatch)
 * resolves to null so the caller falls back to its existing supplementary
 * context. The Sails clients are cached per GearApi to avoid re-parsing the
 * IDL each poll.
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
const AGENT_PULSE_PROGRAM_ID =
  '0x61219b6e1a0724ac67c2e1133e6c5aaaddbfb88a0b457f93e6b94e02bdb27e6b' as `0x${string}`;

const VARABRIDGE_IDL_NAME = 'vara_bridge.idl';
const AGENT_PULSE_IDL_NAME = 'agent_pulse.idl';

const EXTERNAL_TIMEOUT_MS = 8_000;

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
let agentPulseSailsPromise: Promise<Sails> | null = null;

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

async function getAgentPulseSails(api: GearApi): Promise<Sails> {
  if (!agentPulseSailsPromise) {
    agentPulseSailsPromise = (async () => {
      const parser = await SailsIdlParser.new();
      const sails = new Sails(parser);
      sails.parseIdl(loadIdl(AGENT_PULSE_IDL_NAME));
      sails.setApi(api);
      sails.setProgramId(AGENT_PULSE_PROGRAM_ID);
      return sails;
    })();
  }
  return agentPulseSailsPromise;
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
 * Calls VaraBridge/GetPrice as a signed extrinsic. Gas-only (no value).
 * Returns { usd, txHash } on success, null on any failure.
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
    const sent = await withTimeout(tx.signAndSend(), EXTERNAL_TIMEOUT_MS, 'varabridge.GetPrice send');
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

export interface AgentPulsePost {
  id: string;
  authorShortHex: string;
  bodyShort: string;
  block: number;
}

interface PulsePostRaw {
  id: bigint | number | string;
  author: string;
  content: string;
  reply_to: bigint | number | string | null;
  replies: Array<bigint | number | string>;
  block: number;
  value_paid: bigint | number | string;
}

/**
 * Read-only query against PulseService/GetFeed. Doesn't count for
 * integrationsOutWalletInitiated, but feeds the LLM a slice of recent
 * ecosystem chatter.
 */
export async function getAgentPulseFeed(
  api: GearApi,
  count = 3,
): Promise<AgentPulsePost[] | null> {
  try {
    const sails = await getAgentPulseSails(api);
    const qb = sails.services.PulseService.queries.GetFeed(count);
    const raw = (await withTimeout(qb.call(), EXTERNAL_TIMEOUT_MS, 'agent-pulse.GetFeed')) as
      | PulsePostRaw[]
      | null
      | undefined;
    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
    return raw.slice(0, count).map((p) => {
      const author = String(p.author);
      const content = String(p.content ?? '');
      const bodyShort = content.length > 140 ? `${content.slice(0, 137)}...` : content;
      return {
        id: String(p.id),
        authorShortHex: author.length > 12 ? `${author.slice(0, 8)}…${author.slice(-4)}` : author,
        bodyShort,
        block: Number(p.block),
      };
    });
  } catch {
    return null;
  }
}
