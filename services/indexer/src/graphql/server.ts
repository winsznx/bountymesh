/**
 * HTTP server (Boot Stage 6).
 *
 * node:http.createServer mounting:
 *   /graphql        → PostGraphile middleware
 *   /graphiql       → PostGraphile GraphiQL IDE (dev-only — handled inside middleware via graphiql flag)
 *   /health         → JSON health response (lifecycle/health.ts)
 *   *               → 404 JSON
 *
 * CORS:
 *   PostGraphile owns CORS for /graphql via enableCors. For /health we
 *   apply CORS at this layer using config.apiCorsOrigin. OPTIONS preflight
 *   returns 204.
 *
 * Boots LAST in lifecycle/boot.ts so PostGraphile introspection sees the
 * final migrated schema.
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type pg from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Logger } from 'pino';
import type { IndexerConfig } from '../config.js';
import { buildHealthResponse, type HealthState } from '../lifecycle/health.js';
import { buildPostgraphileMiddleware } from './postgraphile.js';

export interface ServerDeps {
  config: IndexerConfig;
  readerPool: pg.Pool;
  writerPool: pg.Pool;
  writerDb: NodePgDatabase;
  healthState: HealthState;
  logger: Logger;
}

export interface ServerHandle {
  server: http.Server;
  port: number;
  close(): Promise<void>;
}

/**
 * CORS allowlist resolver.
 *
 * config.apiCorsOrigin is a comma-separated allowlist (or `*` to allow any).
 * We echo back the request's Origin verbatim iff it appears in the allowlist,
 * which is required for browser credentials-mode requests. Wildcards are
 * supported only when the allowlist is the single string "*".
 *
 * Production indexer should set API_CORS_ORIGIN to
 * "https://bountymesh.xyz,https://www.bountymesh.xyz" — never *.
 */
function resolveCorsOrigin(requestOrigin: string | undefined, allowlist: string): string | null {
  if (allowlist === '*') return '*';
  if (!requestOrigin) return null;
  const allowed = allowlist.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowlist: string): void {
  const requestOrigin = req.headers.origin;
  const allowed = resolveCorsOrigin(requestOrigin, allowlist);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  return (async () => {
    applyCors(req, res, deps.config.apiCorsOrigin);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    try {
      const health = await buildHealthResponse({
        state: deps.healthState,
        writerPool: deps.writerPool,
        db: deps.writerDb,
      });
      res.statusCode = health.status === 'error' ? 503 : 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(health));
    } catch (err: unknown) {
      deps.logger.error({ op: 'health_check', err: String(err) }, '/health failed');
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', error: 'health probe failed' }));
    }
  })();
}

export function startHttpServer(deps: ServerDeps): ServerHandle {
  const { config, readerPool, logger } = deps;
  const pgMiddleware = buildPostgraphileMiddleware(readerPool, config);

  const server = http.createServer((req, res) => {
    // /health is owned by us; everything else (including /graphql, /graphiql,
    // and 404 fallthrough) passes through PostGraphile first.
    const urlPath = (req.url ?? '').split('?')[0];
    if (urlPath === '/health') {
      void handleHealth(req, res, deps);
      return;
    }

    // Apply CORS BEFORE handing off to PostGraphile so our allowlist takes
    // precedence over its (permissive) built-in CORS on matched routes.
    applyCors(req, res, config.apiCorsOrigin);
    // PostGraphile routing: middleware handles /graphql + /graphiql; calls
    // next() for anything else. We provide next as a 404 JSON.
    pgMiddleware(req as never, res as never, () => {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not found', path: urlPath }));
    });
  });

  server.listen(config.apiPort);
  logger.info(
    { op: 'boot', port: config.apiPort, graphql: '/graphql', graphiql: process.env.NODE_ENV !== 'production' ? '/graphiql' : null, health: '/health' },
    'http server listening',
  );

  return {
    server,
    port: config.apiPort,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
