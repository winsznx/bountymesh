/**
 * External Sails calls invoked once per cycle from the cycler. Currently
 * targets the varabridge price feed: a gas-only signed extrinsic that fetches
 * the current VARA/USD micro-price so the cycler can stamp the rendered
 * bounty description with a live USD anchor. Mirrors the loadFeedsIdl /
 * buildFeedsSails pattern from feeds.ts; reuses the cycler's GearApi +
 * KeyringPair so no second WS connection is opened.
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

const PRICE_CALL_TIMEOUT_MS = 10_000;

function loadVaraBridgeIdl(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', 'vara_bridge.idl'),
    join(here, 'vara_bridge.idl'),
    '/app/vara_bridge.idl',
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
  }
  throw new Error('vara_bridge.idl not found on disk; bundle it next to dist/');
}

export async function buildVaraBridgeSails(api: GearApi): Promise<Sails> {
  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(loadVaraBridgeIdl());
  sails.setApi(api);
  sails.setProgramId(VARABRIDGE_PROGRAM_ID);
  return sails;
}

export interface VaraUsdRate {
  priceUsdMicro: bigint;
  priceUsd: number;
  txHash: string;
}

interface PriceFeedReply {
  symbol: string;
  price_usd_micro: bigint | number | string;
  change_24h_bps: number;
  market_cap_usd: bigint | number | string;
  volume_24h_usd: bigint | number | string;
  updated_at_block: number;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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

export async function getVaraUsdRate(
  api: GearApi,
  signer: KeyringPair,
): Promise<VaraUsdRate | null> {
  try {
    const sails = await buildVaraBridgeSails(api);
    const tx = sails.services.VaraBridge.functions.GetPrice('VARA');
    tx.withAccount(signer);
    await tx.calculateGas();
    const sent = await withTimeout(tx.signAndSend(), PRICE_CALL_TIMEOUT_MS, 'VaraBridge.GetPrice');
    const reply = (await withTimeout(
      sent.response() as Promise<PriceFeedReply | null | undefined>,
      PRICE_CALL_TIMEOUT_MS,
      'VaraBridge.GetPrice.response',
    )) as PriceFeedReply | null | undefined;
    if (!reply) return null;
    const priceUsdMicro = BigInt(reply.price_usd_micro);
    if (priceUsdMicro === 0n) return null;
    return {
      priceUsdMicro,
      priceUsd: Number(priceUsdMicro) / 1_000_000,
      txHash: String(sent.txHash),
    };
  } catch {
    return null;
  }
}
