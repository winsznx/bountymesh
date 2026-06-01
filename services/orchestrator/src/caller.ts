/**
 * Phase-3 orchestrator caller. Takes a RouteResult and executes the
 * corresponding query-only Sails call against the discovered program.
 *
 * Hard rules enforced here (defence in depth with the router):
 * - Only `callType === 'query'` is invoked. Function-style entries throw
 *   immediately rather than triggering an on-chain signed extrinsic; the
 *   router should never produce them, but the caller is the last gate
 *   before chain RPC.
 * - 10s timeout on the query RPC sim. Any error / timeout collapses to
 *   a structured ExternalResultErr; the worker falls back to Groq.
 *
 * Sails clients are cached per programId so we parse each IDL once even
 * across many bounty cycles. IDL files are loaded from disk on first
 * touch; we search a small list of well-known paths so the module works
 * whether the consuming worker runs from services/worker (relative
 * import) or from /app inside a container (absolute mount).
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GearApi } from '@gear-js/api';
import { Sails } from 'sails-js';
import { SailsIdlParser } from 'sails-js-parser';

import type { ExternalResult, RouteResult } from './types.js';

const QUERY_TIMEOUT_MS = 10_000;

const HERE = dirname(fileURLToPath(import.meta.url));

const IDL_SEARCH_DIRS = [
  join(HERE, '..', 'data', 'idls'),
  join(HERE, '..', '..', 'data', 'idls'),
  join(process.cwd(), 'services', 'orchestrator', 'data', 'idls'),
  join(process.cwd(), '..', 'orchestrator', 'data', 'idls'),
  '/app/orchestrator-idls',
];

const sailsCache = new Map<`0x${string}`, Promise<Sails>>();

function sanitizeHandle(app: string): string {
  return app
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findIdlPath(handle: string): string {
  const filename = `${handle}.idl`;
  for (const dir of IDL_SEARCH_DIRS) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`IDL file not found for handle "${handle}" (searched ${IDL_SEARCH_DIRS.length} paths)`);
}

function loadIdl(handle: string): string {
  const path = findIdlPath(handle);
  return readFileSync(path, 'utf-8');
}

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${tag} timed out after ${ms}ms`)), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function buildOrchestratorSails(
  api: GearApi,
  idlPath: string,
  programId: `0x${string}`,
): Promise<Sails> {
  if (!existsSync(idlPath)) {
    throw new Error(`IDL path does not exist: ${idlPath}`);
  }
  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(readFileSync(idlPath, 'utf-8'));
  sails.setApi(api);
  sails.setProgramId(programId);
  return sails;
}

async function getSailsForProgram(
  api: GearApi,
  app: string,
  programId: `0x${string}`,
): Promise<Sails> {
  const cached = sailsCache.get(programId);
  if (cached) return cached;
  const promise = (async () => {
    const parser = await SailsIdlParser.new();
    const sails = new Sails(parser);
    sails.parseIdl(loadIdl(sanitizeHandle(app)));
    sails.setApi(api);
    sails.setProgramId(programId);
    return sails;
  })();
  sailsCache.set(programId, promise);
  promise.catch(() => sailsCache.delete(programId));
  return promise;
}

export async function executeRoute(
  api: GearApi,
  route: RouteResult,
): Promise<ExternalResult> {
  const sourceMethod = `${route.service}/${route.method}`;

  if (route.callType !== 'query') {
    return {
      ok: false,
      error: `executeRoute refuses non-query callType "${route.callType}"`,
      source_program: route.programId,
      source_method: sourceMethod,
    };
  }

  try {
    const sails = await getSailsForProgram(api, route.app, route.programId);
    const service = sails.services[route.service];
    if (!service) {
      return {
        ok: false,
        error: `service "${route.service}" not present in IDL for ${route.app}`,
        source_program: route.programId,
        source_method: sourceMethod,
      };
    }
    const query = service.queries[route.method];
    if (!query) {
      return {
        ok: false,
        error: `query "${route.method}" not present on service "${route.service}"`,
        source_program: route.programId,
        source_method: sourceMethod,
      };
    }

    const builder = query(...route.args);
    const data = await withTimeout(builder.call(), QUERY_TIMEOUT_MS, `${route.app}.${sourceMethod}`);

    return {
      ok: true,
      data,
      source_program: route.programId,
      source_method: sourceMethod,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      source_program: route.programId,
      source_method: sourceMethod,
    };
  }
}

export function clearSailsCache(): void {
  sailsCache.clear();
}
