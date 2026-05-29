import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { sha256Hex } from '../../src/envelope/sha256.js';

describe('sha256Hex', () => {
  it('hashes empty string to the known SHA-256 empty vector', () => {
    assert.equal(
      sha256Hex(''),
      '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc" to the known SHA-256 vector', () => {
    assert.equal(
      sha256Hex('abc'),
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('accepts Buffer input identically to string', () => {
    assert.equal(
      sha256Hex(Buffer.from('abc', 'utf-8')),
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('emits lowercase hex with 0x prefix and exactly 64 hex chars', () => {
    const h = sha256Hex('test');
    assert.match(h, /^0x[0-9a-f]{64}$/);
  });
});
