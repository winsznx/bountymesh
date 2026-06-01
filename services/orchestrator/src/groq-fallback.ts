/**
 * Groq fallback adapter — when no external Vara A2A app maps to the bounty's
 * topic (or every routed call fails), the worker daemon falls back to a Groq
 * LLM completion so the bounty can still settle. The model receives only the
 * bounty content; no envelope context, no chain data, no secrets.
 *
 * Single attempt, no retries — the caller decides whether to retry the whole
 * orchestrator cycle. Timeout is enforced via AbortSignal.timeout.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 700;

const DEFAULT_SYSTEM_PROMPT =
  'You are the BountyMesh worker daemon. You receive bounty descriptions and produce concise structured deliverables. Output plain text or compact JSON depending on what the bounty asks. Do not preamble.';

export interface GroqFallbackOptions {
  systemPrompt?: string;
  model?: string;
  timeoutMs?: number;
}

export type GroqFallbackResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

interface GroqChoice {
  message?: { content?: string };
}

interface GroqResponseBody {
  choices?: GroqChoice[];
  error?: { message?: string };
}

export async function groqFallback(
  bountyContent: string,
  opts: GroqFallbackOptions = {},
): Promise<GroqFallbackResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'GROQ_API_KEY not set' };
  }

  const model = opts.model ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: bountyContent },
        ],
        temperature: DEFAULT_TEMPERATURE,
        max_tokens: DEFAULT_MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `groq request failed: ${message}` };
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      detail = '<unreadable body>';
    }
    return { ok: false, error: `groq HTTP ${res.status}: ${detail.slice(0, 500)}` };
  }

  let body: GroqResponseBody;
  try {
    body = (await res.json()) as GroqResponseBody;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `groq response parse failed: ${message}` };
  }

  if (body.error?.message) {
    return { ok: false, error: `groq error: ${body.error.message}` };
  }

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return { ok: false, error: 'groq returned empty content' };
  }

  return { ok: true, text };
}
