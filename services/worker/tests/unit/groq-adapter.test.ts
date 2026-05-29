import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type OpenAI from 'openai';
import { GroqAdapter } from '../../src/adapter/index.js';
import type { Candidate } from '../../src/discovery/types.js';

const OTHER_ADDRESS = `0x${'bb'.repeat(32)}` as const;
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

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

interface ChatCompletionsCreateArgs {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletionsCreateResponse {
  choices: Array<{ message: { role: string; content: string } }>;
}

function makeMockClient(
  handler: (args: ChatCompletionsCreateArgs) => Promise<ChatCompletionsCreateResponse>,
): OpenAI {
  return {
    chat: {
      completions: {
        create: handler,
      },
    },
  } as unknown as OpenAI;
}

describe('GroqAdapter', () => {
  it('fail-fast at construction when apiKey is empty', () => {
    assert.throws(
      () =>
        new GroqAdapter({
          apiKey: '',
          model: DEFAULT_MODEL,
          client: makeMockClient(async () => ({ choices: [] })),
        }),
      /apiKey is required/,
    );
  });

  it('happy path: 1 attempt → success → output_inline + sha256 populated', async () => {
    let callCount = 0;
    const adapter = new GroqAdapter({
      apiKey: 'gsk_test',
      model: DEFAULT_MODEL,
      client: makeMockClient(async () => {
        callCount++;
        return {
          choices: [{ message: { role: 'assistant', content: 'TEST_OK' } }],
        };
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
    let captured: ChatCompletionsCreateArgs | null = null;
    const adapter = new GroqAdapter({
      apiKey: 'gsk_test',
      model: DEFAULT_MODEL,
      client: makeMockClient(async (args) => {
        captured = args;
        return {
          choices: [{ message: { role: 'assistant', content: 'OK' } }],
        };
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
    const args = captured as ChatCompletionsCreateArgs | null;
    assert.ok(args, 'mock should have been called');
    if (!args) return;
    assert.equal(args.model, DEFAULT_MODEL);
    assert.equal(args.temperature, 0);
    // OpenAI message ordering: system at [0], user at [1].
    const systemMsg = args.messages[0];
    const userMsg = args.messages[1];
    assert.equal(systemMsg.role, 'system');
    assert.equal(userMsg.role, 'user');
    assert.match(userMsg.content, /Title: PROMPT_TITLE/);
    assert.match(userMsg.content, /Description: PROMPT_DESC/);
    assert.match(userMsg.content, /Acceptance:\nPROMPT_ACC/);
  });

  it('retry path: first attempt throws, second succeeds → attempts=2', async () => {
    let callCount = 0;
    const adapter = new GroqAdapter({
      apiKey: 'gsk_test',
      model: DEFAULT_MODEL,
      retryBackoffMs: 1,
      client: makeMockClient(async () => {
        callCount++;
        if (callCount === 1) throw new Error('transient');
        return {
          choices: [{ message: { role: 'assistant', content: 'TEST_OK_RETRY' } }],
        };
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
    const adapter = new GroqAdapter({
      apiKey: 'gsk_test',
      model: DEFAULT_MODEL,
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
    const apiKey = 'gsk_supersecret123';
    const adapter = new GroqAdapter({
      apiKey,
      model: DEFAULT_MODEL,
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
    const adapter = new GroqAdapter({
      apiKey: 'gsk_test',
      model: DEFAULT_MODEL,
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
    const adapter = new GroqAdapter({
      apiKey: 'gsk_test',
      model: DEFAULT_MODEL,
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
