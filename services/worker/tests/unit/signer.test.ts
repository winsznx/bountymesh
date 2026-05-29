import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, afterEach, it } from 'node:test';
import { join } from 'node:path';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  loadSigner,
  SignerLoadError,
  KeystoreError,
  EnvSignerError,
} from '../../src/signer/index.js';
import { ENV_VAR_NAME } from '../../src/signer/env.js';
import { makeTmpDir, cleanupTmpDir, writeFixture } from '../harness/tmp.js';

// Distinctive cross-suite fixtures (distinct from gtest's phase-3-indexer-smoke,
// SDK's sdk-decode-fixture-*, indexer's indexer-projection-*).
const KEYSTORE_FIXTURE_URI = '//Test-worker-keystore-fixture';
const ENV_FIXTURE_URI = '//Test-worker-env-fixture';
const KEYSTORE_FILENAME = 'bountymesh-worker-1-test-fixture.json';

describe('signer — keystore + env precedence', () => {
  let tmpDir: string;
  let validKeystorePath: string;
  let validKeystoreAddress: string;
  let envFixtureAddress: string;
  let originalEnv: string | undefined;

  before(async () => {
    await cryptoWaitReady();
    tmpDir = makeTmpDir();

    // Generate a valid keystore JSON from a deterministic test URI.
    const keyring = new Keyring({ type: 'sr25519' });
    const keystorePair = keyring.addFromUri(KEYSTORE_FIXTURE_URI);
    validKeystoreAddress = keystorePair.address;
    const keystoreJson = keystorePair.toJson(''); // empty password = "unencrypted"
    validKeystorePath = writeFixture(tmpDir, KEYSTORE_FILENAME, JSON.stringify(keystoreJson));

    // Pre-compute the env fixture's address for comparison.
    const envPair = keyring.addFromUri(ENV_FIXTURE_URI);
    envFixtureAddress = envPair.address;

    originalEnv = process.env[ENV_VAR_NAME];
  });

  after(() => {
    cleanupTmpDir(tmpDir);
    if (originalEnv === undefined) delete process.env[ENV_VAR_NAME];
    else process.env[ENV_VAR_NAME] = originalEnv;
  });

  beforeEach(() => {
    delete process.env[ENV_VAR_NAME];
  });

  afterEach(() => {
    delete process.env[ENV_VAR_NAME];
  });

  it('happy keystore path: file present + valid → source=keystore', async () => {
    const result = await loadSigner({ keystorePath: validKeystorePath });
    assert.equal(result.source, 'keystore');
    assert.equal(result.pair.address, validKeystoreAddress);
  });

  it('happy env path: keystore missing + env set → source=env', async () => {
    process.env[ENV_VAR_NAME] = ENV_FIXTURE_URI;
    const missingPath = join(tmpDir, 'does-not-exist.json');
    const result = await loadSigner({ keystorePath: missingPath });
    assert.equal(result.source, 'env');
    assert.equal(result.pair.address, envFixtureAddress);
  });

  it('both missing: SignerLoadError aggregates both diagnostics', async () => {
    const missingPath = join(tmpDir, 'does-not-exist.json');
    await assert.rejects(
      async () => loadSigner({ keystorePath: missingPath }),
      (err: unknown) => {
        assert.ok(err instanceof SignerLoadError);
        assert.ok(err.keystoreError instanceof KeystoreError);
        assert.equal(err.keystoreError.code, 'not-found');
        assert.ok(err.envError instanceof EnvSignerError);
        assert.equal(err.envError.code, 'not-set');
        return true;
      },
    );
  });

  it('present-but-broken keystore fails fast — env NEVER queried even when set+valid', async () => {
    // Architectural rule (P2 §C / orchestrator precedence step 3): a
    // present-but-broken keystore is operator intent. We must NOT silently
    // fall through to env. Test verifies this by setting a VALID env (would
    // succeed if queried) and asserting:
    //   - the throw surfaces the keystore parse-failed error
    //   - envError === null (env was NEVER queried, not just queried-and-failed)
    process.env[ENV_VAR_NAME] = ENV_FIXTURE_URI; // valid env that WOULD work
    const malformedPath = writeFixture(tmpDir, 'malformed.json', '{not valid json');

    await assert.rejects(
      async () => loadSigner({ keystorePath: malformedPath }),
      (err: unknown) => {
        assert.ok(err instanceof SignerLoadError);
        assert.ok(err.keystoreError instanceof KeystoreError);
        assert.equal(err.keystoreError.code, 'parse-failed');
        assert.equal(err.envError, null);
        return true;
      },
    );
  });
});
