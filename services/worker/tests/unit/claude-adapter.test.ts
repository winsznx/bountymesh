import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeApiAdapter } from '../../src/adapter/index.js';
import type { Candidate } from '../../src/discovery/types.js';

const OTHER_ADDRESS = `0x${'bb'.repeat(32)}` as const;

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1n,
    poster: OTHER_ADDRESS,
    reward: 2_000_000_000_000n,
    track: 'Services',
    postedAt: 100,
    title: 'adapter-test-title',
    description: 'adapter-test-description',
    acceptance: 'output the literal string "TEST_OK"',
    deadline: null,
    blockHash: null,
    txHash: null,
    phase: 'live',
    ...overrides,
  };
}

interface MessagesCreateArgs {
  model: string;
  system: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

interface MessagesCreateResponse {
  content: Array<{ type: string; text?: string }>;
}

function makeMockClient(
  handler: (args: MessagesCreateArgs) => Promise<MessagesCreateResponse>,
): Anthropic {
  return {
    messages: {
      create: handler,
    },
  } as unknown as Anthropic;
}

describe('ClaudeApiAdapter', () => {
  it('fail-fast at construction when apiKey is empty', () => {
    assert.throws(
      () =>
        new ClaudeApiAdapter({
          apiKey: '',
          model: 'claude-opus-4-7',
          client: makeMockClient(async () => ({ content: [] })),
        }),
      /apiKey is required/,
    );
  });

  it('happy path: 1 attempt → success → output_inline + sha256 populated', async () => {
    let callCount = 0;
    const adapter = new ClaudeApiAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      client: makeMockClient(async () => {
        callCount++;
        return { content: [{ type: 'text', text: 'TEST_OK' }] };
      }),
    });
    const result = await adapter.execute(makeCandidate(), { crashResumed: false });
    assert.equal(callCount, 1);
    assert.equal(result.output_inline, 'TEST_OK');
    assert.equal(result.upstream.attempts, 1);
    assert.equal(result.upstream.error, null);
    assert.match(result.upstream.response_sha256 ?? '', /^0x[0-9a-f]{64}$/);
  });

  it('user prompt embeds title/description/acceptance with locked labels', async () => {
    let captured: MessagesCreateArgs | null = null;
    const adapter = new ClaudeApiAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      client: makeMockClient(async (args) => {
        captured = args;
        return { content: [{ type: 'text', text: 'OK' }] };
      }),
    });
    await adapter.execute(
      makeCandidate({
        title: 'PROMPT_TITLE',
        description: 'PROMPT_DESC',
        acceptance: 'PROMPT_ACC',
      }),
      { crashResumed: false },
    );
    const args = captured as MessagesCreateArgs | null;
    assert.ok(args, 'mock should have been called');
    if (!args) return;
    assert.equal(args.model, 'claude-opus-4-7');
    assert.equal(args.temperature, 0);
    const userMsg = args.messages[0];
    assert.equal(userMsg.role, 'user');
    assert.match(userMsg.content, /Title: PROMPT_TITLE/);
    assert.match(userMsg.content, /Description: PROMPT_DESC/);
    assert.match(userMsg.content, /Acceptance:\nPROMPT_ACC/);
  });

  it('retry path: first attempt throws, second succeeds → attempts=2', async () => {
    let callCount = 0;
    const adapter = new ClaudeApiAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      retryBackoffMs: 1,
      client: makeMockClient(async () => {
        callCount++;
        if (callCount === 1) throw new Error('transient');
        return { content: [{ type: 'text', text: 'TEST_OK_RETRY' }] };
      }),
    });
    const result = await adapter.execute(makeCandidate(), { crashResumed: false });
    assert.equal(callCount, 2);
    assert.equal(result.output_inline, 'TEST_OK_RETRY');
    assert.equal(result.upstream.attempts, 2);
    assert.equal(result.upstream.error, null);
  });

  it('final failure: all attempts throw → returns failure-shape AdapterOutput (no throw)', async () => {
    let callCount = 0;
    const adapter = new ClaudeApiAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      retryBackoffMs: 1,
      client: makeMockClient(async () => {
        callCount++;
        throw new Error('mock failure');
      }),
    });
    const result = await adapter.execute(makeCandidate(), { crashResumed: false });
    assert.equal(callCount, 2); // initial + 1 retry
    assert.equal(result.output_inline, null);
    assert.equal(result.upstream.attempts, 2);
    assert.ok(result.upstream.error !== null);
    assert.match(result.upstream.error, /^other: mock failure/);
  });

  it('sanitizes API key substring from error messages', async () => {
    const apiKey = 'sk-ant-supersecret123';
    const adapter = new ClaudeApiAdapter({
      apiKey,
      model: 'claude-opus-4-7',
      retryBackoffMs: 1,
      client: makeMockClient(async () => {
        throw new Error(`Failed to authenticate with key ${apiKey} on request`);
      }),
    });
    const result = await adapter.execute(makeCandidate(), { crashResumed: false });
    assert.ok(result.upstream.error !== null);
    assert.ok(
      !result.upstream.error.includes(apiKey),
      `error should not include API key; got: ${result.upstream.error}`,
    );
    assert.match(result.upstream.error, /\*\*\*/);
  });

  it('strips sensitive header values from error messages', async () => {
    const adapter = new ClaudeApiAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      retryBackoffMs: 1,
      client: makeMockClient(async () => {
        throw new Error('failure with request-id: abc-123-xyz and cf-ray: yz9');
      }),
    });
    const result = await adapter.execute(makeCandidate(), { crashResumed: false });
    assert.ok(result.upstream.error !== null);
    assert.ok(
      !result.upstream.error.includes('abc-123-xyz'),
      `request-id value should be redacted; got: ${result.upstream.error}`,
    );
    assert.ok(
      !result.upstream.error.includes('yz9'),
      `cf-ray value should be redacted; got: ${result.upstream.error}`,
    );
  });

  it('caps last_error at 200 chars', async () => {
    const adapter = new ClaudeApiAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      retryBackoffMs: 1,
      client: makeMockClient(async () => {
        throw new Error('x'.repeat(500));
      }),
    });
    const result = await adapter.execute(makeCandidate(), { crashResumed: false });
    assert.ok(result.upstream.error !== null);
    assert.ok(
      result.upstream.error.length <= 200,
      `error length should be ≤200, got: ${result.upstream.error.length}`,
    );
  });
});
