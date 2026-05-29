import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalJsonError, canonicalJson } from '../../src/envelope/canonical-json.js';

describe('canonicalJson', () => {
  it('produces identical output for objects with reordered keys', () => {
    const a = canonicalJson({ a: 1, b: 2, c: 3 });
    const b = canonicalJson({ c: 3, a: 1, b: 2 });
    assert.equal(a, b);
    assert.equal(a, '{"a":1,"b":2,"c":3}');
  });

  it('sorts nested object keys recursively', () => {
    const a = canonicalJson({ outer: { z: 1, a: 2 } });
    assert.equal(a, '{"outer":{"a":2,"z":1}}');
  });

  it('preserves array order (does not sort)', () => {
    assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  });

  it('encodes primitives correctly', () => {
    assert.equal(canonicalJson('hello'), '"hello"');
    assert.equal(canonicalJson(42), '42');
    assert.equal(canonicalJson(true), 'true');
    assert.equal(canonicalJson(false), 'false');
    assert.equal(canonicalJson(null), 'null');
  });

  it('JSON-escapes special characters in strings', () => {
    assert.equal(canonicalJson('a"b'), '"a\\"b"');
    assert.equal(canonicalJson('a\nb'), '"a\\nb"');
  });

  it('encodes Unicode strings stably', () => {
    const a = canonicalJson({ key: '日本語' });
    const b = canonicalJson({ key: '日本語' });
    assert.equal(a, b);
  });

  it('rejects bigint (forces string conversion at boundary)', () => {
    assert.throws(
      () => canonicalJson({ id: 42n }),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalJsonError);
        assert.match(err.message, /bigint/);
        return true;
      },
    );
  });

  it('rejects undefined (forces null explicitly)', () => {
    assert.throws(
      () => canonicalJson({ x: undefined }),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalJsonError);
        assert.match(err.message, /undefined/);
        return true;
      },
    );
  });

  it('rejects non-finite numbers', () => {
    assert.throws(() => canonicalJson(Infinity), CanonicalJsonError);
    assert.throws(() => canonicalJson(NaN), CanonicalJsonError);
  });
});
