import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { HexString } from '@gear-js/api/types';
import {
  eventBlockNumber,
  PendingBuffer,
  type BufferedEvent,
} from '../../src/chain/buffer.js';

const ZERO_ADDR = ('0x' + '0'.repeat(64)) as HexString;
const ZERO_TX = ('0x' + '0'.repeat(64)) as HexString;

function posted(blockHash: string, postedAt: number, id = 1n): BufferedEvent {
  return {
    eventName: 'BountyPosted',
    id,
    poster: ZERO_ADDR,
    reward: 1_000_000_000_000n,
    track: 'Services',
    postedAt,
    title: '',
    description: '',
    acceptance: '',
    deadline: null,
    blockHash: blockHash as HexString,
    txHash: ZERO_TX,
  };
}

function claimed(blockHash: string, claimedAt: number, id = 1n): BufferedEvent {
  return {
    eventName: 'BountyClaimed',
    id,
    worker: ZERO_ADDR,
    claimedAt,
    blockHash: blockHash as HexString,
    txHash: ZERO_TX,
  };
}

describe('PendingBuffer', () => {
  it('push then take returns events; subsequent take returns empty', () => {
    const buf = new PendingBuffer();
    const ev = posted('0xb100', 100);
    buf.push(ev);
    const taken = buf.take('0xb100' as HexString);
    assert.equal(taken.length, 1);
    assert.equal(taken[0]!.eventName, 'BountyPosted');
    const again = buf.take('0xb100' as HexString);
    assert.equal(again.length, 0);
  });

  it('push to same blockHash appends', () => {
    const buf = new PendingBuffer();
    buf.push(posted('0xb100', 100, 1n));
    buf.push(claimed('0xb100', 100, 1n));
    assert.equal(buf.size(), 2);
    const events = buf.take('0xb100' as HexString);
    assert.equal(events.length, 2);
    assert.equal(events[0]!.eventName, 'BountyPosted');
    assert.equal(events[1]!.eventName, 'BountyClaimed');
  });

  it('blockHashesUpTo returns only blocks with blockNumber <= N', () => {
    const buf = new PendingBuffer();
    buf.push(posted('0xb050', 50));
    buf.push(posted('0xb100', 100));
    buf.push(posted('0xb150', 150));
    const upTo100 = buf.blockHashesUpTo(100).sort();
    assert.deepEqual(upTo100, ['0xb050', '0xb100']);
    const upTo50 = buf.blockHashesUpTo(50);
    assert.deepEqual(upTo50, ['0xb050']);
    const upTo10 = buf.blockHashesUpTo(10);
    assert.deepEqual(upTo10, []);
  });

  it('drop removes entry without returning', () => {
    const buf = new PendingBuffer();
    buf.push(posted('0xb100', 100));
    buf.drop('0xb100' as HexString);
    assert.equal(buf.size(), 0);
    assert.equal(buf.blockCount(), 0);
    assert.equal(buf.take('0xb100' as HexString).length, 0);
  });

  it('clear wipes everything', () => {
    const buf = new PendingBuffer();
    buf.push(posted('0xb100', 100));
    buf.push(posted('0xb200', 200));
    buf.push(claimed('0xb200', 200));
    buf.clear();
    assert.equal(buf.size(), 0);
    assert.equal(buf.blockCount(), 0);
  });

  it('size aggregates events across blocks; blockCount counts distinct blocks', () => {
    const buf = new PendingBuffer();
    buf.push(posted('0xb100', 100));
    buf.push(claimed('0xb100', 100));
    buf.push(posted('0xb200', 200));
    assert.equal(buf.size(), 3);
    assert.equal(buf.blockCount(), 2);
  });

  it('peek does not remove', () => {
    const buf = new PendingBuffer();
    buf.push(posted('0xb100', 100));
    const peeked = buf.peek('0xb100' as HexString);
    assert.equal(peeked.length, 1);
    assert.equal(buf.size(), 1);
  });

  it('eventBlockNumber extracts block from all 5 event shapes', () => {
    assert.equal(eventBlockNumber(posted('0xb1', 42)), 42);
    assert.equal(eventBlockNumber(claimed('0xb1', 99)), 99);
    assert.equal(
      eventBlockNumber({
        eventName: 'BountySubmitted',
        id: 1n,
        worker: ZERO_ADDR,
        resultHash: ZERO_TX,
        resultPayload: null,
        submittedAt: 7,
        blockHash: '0xb1' as HexString,
        txHash: ZERO_TX,
      }),
      7,
    );
    assert.equal(
      eventBlockNumber({
        eventName: 'BountyAccepted',
        id: 1n,
        poster: ZERO_ADDR,
        worker: ZERO_ADDR,
        reward: 1n,
        settledAt: 13,
        blockHash: '0xb1' as HexString,
        txHash: ZERO_TX,
      }),
      13,
    );
    assert.equal(
      eventBlockNumber({
        eventName: 'BountyWithdrawn',
        id: 1n,
        worker: ZERO_ADDR,
        amount: 1n,
        withdrawnAt: 21,
        blockHash: '0xb1' as HexString,
        txHash: ZERO_TX,
      }),
      21,
    );
  });
});
