/**
 * Generates packages/sdk/src/errors.generated.ts from the IDL snapshot.
 *
 * Single source of truth for the public BountyMeshError + Track types. The
 * sails-js-cli output uses its own `SailsError` string-literal union internally
 * (re-exported via src/generated/_shim.ts) — we generate our consumer-facing
 * types here to avoid polluting the global Error namespace.
 *
 * Flags:
 *   --check  Emit to memory and diff against on-disk; exit non-zero on drift.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IDL_PATH = resolve(SDK_DIR, 'idl/bountymesh.idl');
const OUT_PATH = resolve(SDK_DIR, 'src/errors.generated.ts');

const CHECK_MODE = process.argv.includes('--check');

const idl = readFileSync(IDL_PATH, 'utf8');

function extractEnum(name: string): string[] {
  const re = new RegExp(`type\\s+${name}\\s*=\\s*enum\\s*\\{([\\s\\S]*?)\\};`);
  const m = idl.match(re);
  if (!m) throw new Error(`Could not find enum '${name}' in ${IDL_PATH}`);
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const errorVariants = extractEnum('Error');
const trackVariants = extractEnum('TrackEnum');

if (errorVariants.length === 0 || trackVariants.length === 0) {
  throw new Error('Failed to extract variants from IDL');
}

const header =
  `/* AUTO-GENERATED from packages/sdk/idl/bountymesh.idl by scripts/generate-errors.ts.
 * Run \`make sdk-codegen\` to regenerate. Do not edit by hand.
 * Drift detection: \`make sdk-check-codegen-drift\`. */
`;

const errorUnion = errorVariants.map((v) => `'${v}'`).join('\n  | ');
const trackUnion = trackVariants.map((v) => `'${v}'`).join(' | ');
const errorArrayItems = errorVariants.map((v) => `  '${v}'`).join(',\n');

const output = `${header}
export type BountyMeshError =
  | ${errorUnion};

export type Track = ${trackUnion};

export const ALL_BOUNTYMESH_ERRORS: readonly BountyMeshError[] = [
${errorArrayItems},
] as const;

export const ALL_TRACKS: readonly Track[] = [${trackVariants
  .map((v) => `'${v}'`)
  .join(', ')}] as const;

export function isBountyMeshError(s: unknown): s is BountyMeshError {
  return typeof s === 'string' && (ALL_BOUNTYMESH_ERRORS as readonly string[]).includes(s);
}

export function isTrack(s: unknown): s is Track {
  return typeof s === 'string' && (ALL_TRACKS as readonly string[]).includes(s);
}
`;

if (CHECK_MODE) {
  if (!existsSync(OUT_PATH)) {
    console.error(`DRIFT: ${OUT_PATH} missing`);
    process.exit(1);
  }
  const onDisk = readFileSync(OUT_PATH, 'utf8');
  if (onDisk !== output) {
    console.error(`DRIFT in src/errors.generated.ts.`);
    console.error('Run `make sdk-codegen` to regenerate.');
    process.exit(1);
  }
  console.log('errors codegen: in sync.');
} else {
  writeFileSync(OUT_PATH, output);
  console.log(`Wrote: ${OUT_PATH}`);
}
