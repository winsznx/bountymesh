import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { getFnNamePrefix, getServiceNamePrefix, ZERO_ADDRESS } from 'sails-js';

export interface CapturedEvent {
  eventName: string;
  rawPayload: HexString;
}

/**
 * Subscribe to UserMessageSent events scoped to one program for the duration of `fn`.
 * Returns both the fn's result AND the events captured during its execution.
 *
 * Subscription is established BEFORE fn runs, so any events emitted by the
 * tx fn drives are guaranteed to be caught. A 200ms post-fn delay lets the
 * WS stream flush after tx finalization.
 */
export async function captureProgramEvents<T>(
  api: GearApi,
  programId: HexString,
  fn: () => Promise<T>,
): Promise<{ result: T; events: CapturedEvent[] }> {
  const events: CapturedEvent[] = [];
  const unsub = await api.gearEvents.subscribeToGearEvent(
    'UserMessageSent',
    ({
      data: { message },
    }: {
      data: {
        message: {
          source: { eq: (x: HexString) => boolean };
          destination: { eq: (x: HexString) => boolean };
          payload: { toHex: () => HexString };
        };
      };
    }) => {
      if (!message.source.eq(programId) || !message.destination.eq(ZERO_ADDRESS)) return;
      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) !== 'BountyService') return;
      events.push({ eventName: getFnNamePrefix(payload), rawPayload: payload });
    },
  );
  try {
    const result = await fn();
    await new Promise((r) => setTimeout(r, 200));
    return { result, events };
  } finally {
    unsub();
  }
}

export function rawPayloadToBytes(hex: HexString): Uint8Array {
  const clean = hex.slice(2);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
