/**
 * SDK subscriptions + finalized-heads listener (Boot Stage 5).
 *
 * Two-stream architecture (Step 2 §3.2, Step 3 Q2 Path A):
 *   1. SDK BountyMeshClient.onBountyX(null, callback) for all 5 events
 *      → callback pushes to PendingBuffer keyed by blockHash
 *   2. api.rpc.chain.subscribeFinalizedHeads
 *      → on each finalized head N:
 *          for blockHash in buffer.blockHashesUpTo(N):
 *            canonicalHash = await api.rpc.chain.getBlockHash(blockNumber)
 *            if canonicalHash.eq(blockHash): take + dispatch
 *            else: drop (orphaned by reorg)
 *
 * Production `onCanonicalEvents` wiring (Step 5c):
 *   Boot.ts injects `(blockHash, blockNumber, events) => dispatchBlockEvents(
 *     { db, logger }, blockHash, blockNumber, events)`. The seam keeps
 *   subscriptions.ts free of ingest/* imports — single direction of dependency.
 *   Tests can substitute a different handler (the 5b chain-plumbing test uses a
 *   logger-only stub; the 5c ingestion test uses the real dispatch).
 *
 * Catch-up gap (Stage 4 → Stage 5 transition) — LOCKED at Option (b):
 *   Stage 4: backfill (last_finalized_block, headFinalized@stage4start]
 *   Stage 5: openSubscriptions() opens optimistic + finalized streams
 *   Stage 5.5: small backfill (last_finalized_block, currentFinalizedHead]
 *              before declaring HealthState.mode = 'live'
 *
 *   Reasoning (vs Option (a) — subscribe-before-backfill-then-buffer):
 *   - (b) reuses backfill.ts; single code path for "catch up the gap"
 *   - No ordering complexity between buffered-finalized-heads and backfill events
 *   - The 1–3 block gap is bounded by Stage 4 duration × block rate
 *   - ~3 RPCs to walk the gap; cheap
 *   - During Stage 5.5, the SDK subscription is already open. Both paths
 *     (Stage 5.5 backfill + optimistic-then-finalized) converge through
 *     dispatch.ts's idempotent insert (ON CONFLICT event_uid DO NOTHING).
 *
 *   Boot orchestration belongs in lifecycle/boot.ts (Step 5f); this file is
 *   the Stage 5 primitive that boot.ts composes with backfill.ts.
 *
 * SDK signer note:
 *   BountyMeshClient's constructor validates that `signer` is a KeyringPair
 *   or InjectedSignerWithAddress (packages/sdk/src/client.ts). The indexer
 *   NEVER signs; it only subscribes. We provide a throwaway sr25519 pair
 *   generated from a fixed URI ('//bountymesh-indexer-no-sign') that is
 *   never used to sign anything. Surfaced as Step 5b judgment call #2.
 *   Long-term resolution: a SDK refactor to make signer optional when only
 *   event subscribers are consumed (Phase 7 polish).
 */

import { BountyMeshClient } from '@bountymesh/sdk';
import type {
  BountyAcceptedEvent,
  BountyClaimedEvent,
  BountyPostedEvent,
  BountySubmittedEvent,
  BountyWithdrawnEvent,
} from '@bountymesh/sdk';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { TypeRegistry } from '@polkadot/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { Logger } from 'pino';
import { eventBlockNumber, PendingBuffer, type BufferedEvent } from './buffer.js';
import { decodeBlockEvents } from './decode.js';

export type CanonicalEventsHandler = (
  blockHash: HexString,
  blockNumber: number,
  events: BufferedEvent[],
) => Promise<void>;

export interface SubscriptionsOptions {
  api: GearApi;
  programId: HexString;
  registry: TypeRegistry;
  buffer: PendingBuffer;
  onCanonicalEvents: CanonicalEventsHandler;
  logger: Logger;
}

export interface SubscriptionsHandle {
  /** Tears down all 6 subscriptions (5 SDK + 1 finalized-heads). */
  close(): Promise<void>;
}

/** Minimal shape for header passed to the finalized-heads subscriber. */
interface FinalizedHeader {
  number: { toNumber: () => number };
  hash: { toHex: () => HexString };
}

export async function openSubscriptions(
  opts: SubscriptionsOptions,
): Promise<SubscriptionsHandle> {
  const { api, programId, registry, buffer, onCanonicalEvents, logger } = opts;

  // Throwaway signer to satisfy BountyMeshClient's constructor validation.
  await cryptoWaitReady();
  const throwawaySigner: KeyringPair = new Keyring({ type: 'sr25519' }).addFromUri(
    '//bountymesh-indexer-no-sign',
  );

  const client = new BountyMeshClient({
    api,
    programId,
    signer: throwawaySigner,
  });

  const unsubs: Array<() => void> = [];

  const pushHandler =
    <T extends BufferedEvent['eventName']>(eventName: T) =>
    (e: BountyPostedEvent | BountyClaimedEvent | BountySubmittedEvent | BountyAcceptedEvent | BountyWithdrawnEvent): void => {
      const event = { eventName, ...e } as BufferedEvent;
      buffer.push(event);
      logger.debug(
        {
          op: 'ingest_event',
          phase: 'optimistic',
          eventName,
          blockHash: event.blockHash,
          blockNumber: eventBlockNumber(event),
          bountyId: event.id.toString(),
        },
        'event buffered',
      );
    };

  unsubs.push(await client.onBountyPosted(null, pushHandler('BountyPosted')));
  unsubs.push(await client.onBountyClaimed(null, pushHandler('BountyClaimed')));
  unsubs.push(await client.onBountySubmitted(null, pushHandler('BountySubmitted')));
  unsubs.push(await client.onBountyAccepted(null, pushHandler('BountyAccepted')));
  unsubs.push(await client.onBountyWithdrawn(null, pushHandler('BountyWithdrawn')));

  const finalizedUnsubAsync = api.rpc.chain.subscribeFinalizedHeads(async (header: FinalizedHeader) => {
    const finalizedBlockNumber = header.number.toNumber();
    const candidateHashes = buffer.blockHashesUpTo(finalizedBlockNumber);
    if (candidateHashes.length === 0) return;

    for (const blockHash of candidateHashes) {
      const peeked = buffer.peek(blockHash);
      if (peeked.length === 0) {
        buffer.drop(blockHash);
        continue;
      }
      const blockNumber = eventBlockNumber(peeked[0]!);

      // Bug #11 fix: use getHeader(blockHash) as the canonicality check.
      // Succeeds → block is in the canonical chain (project + remove from
      // buffer). Fails → pruned or reorged-out (drop). No getBlockHash
      // lookup — that path exhibits a ~2-block lag on gear --dev between
      // subscribeNewHeads's optimistic event observation and the finalized
      // stream's number→hash mapping, always mismatching for in-flight
      // blocks. getHeader(blockHash) is direct and version-agnostic.
      try {
        await api.rpc.chain.getHeader(blockHash);
      } catch (err: unknown) {
        logger.warn(
          {
            op: 'ingest_event',
            phase: 'orphan_or_pruned',
            blockHash,
            blockNumber,
            droppedCount: peeked.length,
            err: String(err),
          },
          'block not retrievable; dropping buffered events',
        );
        buffer.drop(blockHash);
        continue;
      }

      // Bug #12 fix at the boundary: the SDK's buffered events carry a
      // txHash that points to gear::run (constant per chain), not to the
      // user's signed extrinsic. Re-decode from chain at finalized time —
      // decode.ts's findOriginatingTxHash correlates via messageId and
      // returns the correct per-event tx hashes.
      buffer.drop(blockHash);
      try {
        const freshEvents = await decodeBlockEvents(api, programId, blockHash, registry);
        if (freshEvents.length === 0) {
          logger.warn(
            {
              op: 'ingest_event',
              phase: 'no_events_at_finalized',
              blockHash,
              blockNumber,
              bufferedCount: peeked.length,
            },
            'buffer had events but chain re-fetch returned none; skipping',
          );
          continue;
        }
        await onCanonicalEvents(blockHash, blockNumber, freshEvents);
      } catch (err: unknown) {
        logger.error(
          {
            op: 'ingest_event',
            phase: 'redecode_failed',
            blockHash,
            blockNumber,
            err: String(err),
          },
          're-decode at finalized time failed; events lost for this block',
        );
      }
    }
  });

  const finalizedUnsub = (await finalizedUnsubAsync) as unknown as () => void;
  unsubs.push(finalizedUnsub);

  return {
    close: async () => {
      for (const unsub of unsubs) {
        try {
          unsub();
        } catch (err: unknown) {
          logger.error({ op: 'shutdown', err: String(err) }, 'unsubscribe failed');
        }
      }
    },
  };
}
