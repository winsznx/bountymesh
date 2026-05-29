/**
 * Localhost echo server for the OpenAI-compatible Chat Completions endpoint
 * used by Groq.
 *
 * Returns a deterministic chat-completions-shaped response for every POST to
 * /openai/v1/chat/completions. Used by failure-mode integration tests to
 * exercise the real GroqAdapter HTTP path WITHOUT requiring a real GROQ_API_KEY
 * or producing real Groq spend. Bound to 127.0.0.1:0 (OS-assigned port) for
 * parallel-test isolation.
 *
 * Response shape mirrors the OpenAI Chat Completions response — minimal but
 * complete enough that the openai SDK parses it without choking. Same response
 * body for every request → envelope hash reproducible across runs given the
 * same bounty id + worker address.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

const RESPONSE_TEXT = 'Bounty fulfilled deterministically.';

const RESPONSE_TEMPLATE = {
  object: 'chat.completion' as const,
  model: 'llama-3.3-70b-versatile',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant' as const,
        content: RESPONSE_TEXT,
      },
      finish_reason: 'stop' as const,
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  },
};

export interface EchoServerHandle {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startEchoServer(): Promise<EchoServerHandle> {
  return new Promise<EchoServerHandle>((resolveStart, rejectStart) => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/openai/v1/chat/completions') {
          const body = {
            id: `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
            created: Math.floor(Date.now() / 1000),
            ...RESPONSE_TEMPLATE,
          };
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
          return;
        }
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'unknown route' }));
      });
    });

    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectStart(new Error('echoServer: address() returned null/string'));
        return;
      }
      const port = addr.port;
      // GroqAdapter constructs base URL as `${baseURL}/chat/completions`, so
      // baseURL must end in `/openai/v1` to land on `/openai/v1/chat/completions`.
      const url = `http://127.0.0.1:${port}/openai/v1`;
      resolveStart({
        url,
        port,
        stop: async () =>
          new Promise<void>((resolveStop) => {
            server.close(() => resolveStop());
          }),
      });
    });
  });
}
