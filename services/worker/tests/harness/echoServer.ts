/**
 * Localhost echo server for Anthropic /v1/messages.
 *
 * Returns a deterministic message-shaped response for every POST. Used by
 * P3.9b e2e test (and future P3.10 failure-mode tests) to exercise the
 * real ClaudeApiAdapter HTTP path WITHOUT requiring an ANTHROPIC_API_KEY
 * or producing real Anthropic spend. Bound to 127.0.0.1:0 (OS-assigned
 * port) for parallel-test isolation.
 *
 * Response shape mirrors Anthropic's typed Message — minimal but complete
 * enough that @anthropic-ai/sdk parses it without choking. Same response
 * body for every request → envelope hash reproducible across runs given
 * the same bounty id + worker address.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

const RESPONSE_TEMPLATE = {
  type: 'message' as const,
  role: 'assistant' as const,
  model: 'claude-opus-4-7',
  content: [{ type: 'text' as const, text: 'Bounty fulfilled deterministically.' }],
  stop_reason: 'end_turn' as const,
  stop_sequence: null,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
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
      // Drain the body so the request fully resolves before we respond.
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/v1/messages') {
          const body = {
            id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
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
      const url = `http://127.0.0.1:${port}`;
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
