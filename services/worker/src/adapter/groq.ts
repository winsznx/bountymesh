/**
 * Groq WorkAdapter — uses Groq's OpenAI-compatible Chat Completions endpoint.
 *
 * Calls https://api.groq.com/openai/v1/chat/completions with temperature=0.
 * Per-call timeout 120s, 1 retry with 2s backoff. On final failure returns
 * a failure-shape AdapterOutput (NOT throws) so the FSM can still produce a
 * structurally-valid on-chain Submit with the failure envelope.
 *
 * SYSTEM_PROMPT is a module-level const. envelope.upstream.request_canonical
 * includes the literal string so a reviewer can verify exactly what was sent.
 *
 * Default model: llama-3.3-70b-versatile (Groq's recommended balance of
 * quality + speed for code/text generation).
 */

import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import type { Candidate } from '../discovery/types.js';
import type {
  AdapterOutput,
  ExecuteOptions,
  UpstreamSnapshot,
  WorkAdapter,
} from './types.js';

export const GROQ_ADAPTER_NAME = 'groq';
export const GROQ_ADAPTER_VERSION = '0.1.0';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

const SYSTEM_PROMPT = [
  'You are an AI agent fulfilling on-chain bounties.',
  'Follow the acceptance criteria exactly.',
  'Output the requested artifact only — no preamble, no closing remarks, no commentary.',
  'Keep output under 2000 characters.',
].join(' ');

function buildUserPrompt(candidate: Candidate): string {
  return [
    `Title: ${candidate.title}`,
    '',
    `Description: ${candidate.description}`,
    '',
    'Acceptance:',
    candidate.acceptance,
    '',
    'Produce the requested output.',
  ].join('\n');
}

const GROQ_TIMEOUT_MS = 120_000;
const GROQ_MAX_RETRIES = 1;
const GROQ_RETRY_BACKOFF_MS = 2_000;
const GROQ_MAX_TOKENS = 2048;
const LAST_ERROR_MAX_CHARS = 200;

const SENSITIVE_HEADER_NAMES = [
  'authorization',
  'x-api-key',
  'request-id',
  'x-request-id',
  'groq-organization-id',
  'cf-ray',
  'set-cookie',
  'cookie',
] as const;

export interface GroqAdapterOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxRetries?: number;
  timeoutMs?: number;
  retryBackoffMs?: number;
  /** Inject a mock for unit tests. */
  client?: OpenAI;
}

function sha256Hex(input: string): `0x${string}` {
  const hex = createHash('sha256').update(input, 'utf-8').digest('hex');
  return `0x${hex}` as `0x${string}`;
}

export class GroqAdapter implements WorkAdapter {
  readonly name = GROQ_ADAPTER_NAME;
  readonly version = GROQ_ADAPTER_VERSION;

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(opts: GroqAdapterOptions) {
    if (!opts.apiKey || opts.apiKey.length === 0) {
      throw new Error('GroqAdapter: apiKey is required');
    }
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? GROQ_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? GROQ_MAX_RETRIES;
    this.retryBackoffMs = opts.retryBackoffMs ?? GROQ_RETRY_BACKOFF_MS;
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey,
        baseURL: opts.baseURL ?? GROQ_BASE_URL,
        timeout: this.timeoutMs,
        maxRetries: 0, // we manage retries explicitly
      });
  }

  async execute(candidate: Candidate, _opts: ExecuteOptions): Promise<AdapterOutput> {
    const userPrompt = buildUserPrompt(candidate);
    const requestCanonical = {
      provider: 'groq',
      model: this.model,
      system: SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0,
      max_tokens: GROQ_MAX_TOKENS,
    };
    const requestAt = new Date().toISOString();

    let attempts = 0;
    let lastError: unknown = null;

    for (let i = 0; i <= this.maxRetries; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, this.retryBackoffMs));
      }
      attempts++;

      try {
        const res = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: GROQ_MAX_TOKENS,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        });

        const responseAt = new Date().toISOString();
        const responseInline = res.choices[0]?.message?.content ?? '';
        const responseSha256 = sha256Hex(responseInline);

        const upstream: UpstreamSnapshot = {
          provider: 'groq',
          model: this.model,
          request_canonical: requestCanonical,
          response_sha256: responseSha256,
          response_body_inline: responseInline,
          attempts,
          request_at: requestAt,
          response_at: responseAt,
          error: null,
        };

        return {
          output_inline: responseInline,
          output_blob_url: null,
          output_blob_sha256: null,
          upstream,
        };
      } catch (err) {
        lastError = err;
      }
    }

    // Final failure — return failure-shape AdapterOutput.
    const responseAt = new Date().toISOString();
    return {
      output_inline: null,
      output_blob_url: null,
      output_blob_sha256: null,
      upstream: {
        provider: 'groq',
        model: this.model,
        request_canonical: requestCanonical,
        response_sha256: null,
        response_body_inline: null,
        attempts,
        request_at: requestAt,
        response_at: responseAt,
        error: this.sanitizeError(lastError),
      },
    };
  }

  /**
   * Sanitize an error into a ≤200-char string.
   *
   * Formats (most specific first):
   *   "groq[<status>]: <code-or-message>"
   *   "timeout: <ms>ms exceeded"
   *   "network: <errno>"
   *   "other: <sanitized>"
   *
   * Sanitization:
   *   - replace API key substring with "***"
   *   - strip sensitive header values
   *   - cap at 200 chars (ellipsize)
   */
  private sanitizeError(err: unknown): string {
    let prefix: string;
    let detail = '';

    if (err instanceof OpenAI.APIConnectionTimeoutError) {
      prefix = `timeout: ${this.timeoutMs}ms exceeded`;
    } else if (err instanceof OpenAI.APIConnectionError) {
      prefix = 'network';
      const cause = (err as unknown as { cause?: { code?: string } }).cause;
      detail = this.scrub(cause?.code ?? 'unknown');
    } else if (err instanceof OpenAI.APIError) {
      const status = err.status ?? 0;
      prefix = `groq[${status}]`;
      const body = (err as unknown as { error?: { type?: string; message?: string } }).error;
      detail = this.scrub(body?.type ?? body?.message ?? err.message ?? '');
    } else if (err instanceof Error) {
      prefix = 'other';
      detail = this.scrub(err.message);
    } else {
      prefix = 'other';
      detail = this.scrub(String(err));
    }

    let full = detail.length > 0 ? `${prefix}: ${detail}` : prefix;
    if (full.length > LAST_ERROR_MAX_CHARS) {
      full = full.slice(0, LAST_ERROR_MAX_CHARS - 3) + '...';
    }
    return full;
  }

  private scrub(s: string): string {
    let out = s;
    if (this.apiKey.length > 0) {
      const escaped = this.apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'g'), '***');
    }
    for (const header of SENSITIVE_HEADER_NAMES) {
      const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${escapedHeader}\\s*[:=]\\s*[^\\s,;]+`, 'gi');
      out = out.replace(re, `${header}: ***`);
    }
    return out;
  }
}
