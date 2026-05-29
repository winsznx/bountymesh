#!/usr/bin/env bash
# Generates packages/sdk/src/generated/lib.ts + _shim.ts from the IDL snapshot.
#
# Source of truth: packages/sdk/idl/bountymesh.idl (symlink to ../../agent-starter/idl/bountymesh.idl.snapshot).
# sails-js-cli version: pinned in package.json devDependencies (0.5.1).
#
# Post-processing:
#   - Strips sails-js-cli's global.d.ts (it `declare global`-pollutes the Error type, shadowing built-in).
#   - Emits a module-scoped _shim.ts with the same string-literal unions, renaming Error → SailsError
#     to avoid shadowing the built-in Error class for runtime throws inside lib.ts.
#   - Patches lib.ts to import SailsError + TrackEnum from ./_shim.js and rewrites `err: Error` → `err: SailsError`.
#
# Flags:
#   --check  Generate to a temp dir and diff against src/generated/. Exits non-zero on drift.
#            Mirrors `make check-idl-drift`. Used by `npm run check-codegen-drift` and prepublishOnly.
#
# Run from packages/sdk/.
set -euo pipefail

CHECK_MODE=0
if [ "${1:-}" = "--check" ]; then CHECK_MODE=1; fi

SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IDL_PATH="$SDK_DIR/idl/bountymesh.idl"
OUT_DIR="$SDK_DIR/src/generated"
TMPDIR="$(mktemp -d -t sdk-codegen-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

if [ ! -e "$IDL_PATH" ]; then
  echo "ERROR: IDL not found at $IDL_PATH" >&2
  exit 2
fi

# 1. Run sails-js-cli.
npx --no-install sails-js-cli generate "$IDL_PATH" -o "$TMPDIR/raw" --no-project >/dev/null

# Sanity-check what sails-js-cli emitted. If new files appear we want to know.
EMITTED=$(cd "$TMPDIR/raw" && ls -1 | sort | tr '\n' ' ')
EXPECTED="global.d.ts lib.ts "
if [ "$EMITTED" != "$EXPECTED" ]; then
  echo "WARNING: sails-js-cli emitted unexpected files: $EMITTED" >&2
  echo "         expected: $EXPECTED" >&2
  echo "         Review scripts/generate-client.sh before continuing." >&2
  exit 3
fi

HEADER='/* AUTO-GENERATED from packages/sdk/idl/bountymesh.idl by scripts/generate-client.sh.
 * Run `make sdk-codegen` to regenerate. Do not edit by hand.
 * Drift detection: `make sdk-check-codegen-drift` (or `npm run check-codegen-drift`).
 *
 * Post-processing applied to sails-js-cli@0.5.1 output (working against @gear-js/api@0.44.2):
 *   1. `HexString` import split out of `@gear-js/api` (re-exported via subpath `/types`).
 *   2. `{ data: { message } }` callback param given `:any` — sails-js-cli predates strict @gear-js/api callback typing; refining the type belongs upstream.
 *   3. Error type renamed to SailsError to avoid shadowing the global Error class.
 *   4. global.d.ts stripped; same string-literal unions re-emitted module-scoped in _shim.ts.
 */
'

# 2. Build _shim.ts from global.d.ts:
#    - drop the `declare global {` wrapper and trailing `};`
#    - dedent 2 spaces
#    - rename `Error` → `SailsError` to avoid shadowing the built-in Error runtime class
{
  printf '%s\n' "$HEADER"
  awk '
    /declare global \{/ { next }
    /^\};$/ { next }
    /^$/ { print; next }
    { sub(/^  /, ""); print }
  ' "$TMPDIR/raw/global.d.ts" \
    | sed 's/export type Error =/export type SailsError =/'
} > "$TMPDIR/_shim.ts"

# 3. Patch lib.ts:
#    - prepend AUTO-GENERATED header
#    - split the `HexString` import: pull from '@gear-js/api/types' (sails-js-cli 0.5.1 assumes a root re-export that @gear-js/api 0.44.2 no longer ships)
#    - insert import for SailsError + TrackEnum from ./_shim.js right after the sails-js import
#    - rewrite `err: Error` → `err: SailsError` (type positions only — `new Error(...)` runtime calls untouched)
#    - annotate `({ data: { message } })` callback param as `:any` to satisfy noImplicitAny on generated subscriber methods
{
  printf '%s\n' "$HEADER"
  awk '
    /^import .* from .sails-js.;$/ && !patched {
      print
      print "import type { SailsError, TrackEnum } from '"'"'./_shim.js'"'"';"
      patched = 1
      next
    }
    { print }
  ' "$TMPDIR/raw/lib.ts" \
    | sed \
        -e "s/import { GearApi, BaseGearProgram, HexString } from '@gear-js\/api';/import { GearApi, BaseGearProgram } from '@gear-js\/api';\nimport type { HexString } from '@gear-js\/api\/types';/" \
        -e 's/err: Error/err: SailsError/g' \
        -e 's/(\({ data: { message } }\)) =>/(\1: any) =>/g'
} > "$TMPDIR/lib.ts"

# 4. Drift check OR write outputs.
if [ "$CHECK_MODE" -eq 1 ]; then
  drift=0
  for f in lib.ts _shim.ts; do
    if [ ! -f "$OUT_DIR/$f" ]; then
      echo "DRIFT: $OUT_DIR/$f missing" >&2
      drift=1
      continue
    fi
    if ! diff -u "$OUT_DIR/$f" "$TMPDIR/$f" >/dev/null; then
      echo "DRIFT in src/generated/$f:" >&2
      diff -u "$OUT_DIR/$f" "$TMPDIR/$f" >&2 || true
      drift=1
    fi
  done
  if [ "$drift" -eq 0 ]; then
    echo "client codegen: in sync."
  else
    echo "" >&2
    echo "If the change is intentional: run 'make sdk-codegen'." >&2
    echo "Otherwise: investigate before any publish or SDK consumer regen." >&2
    exit 1
  fi
else
  mkdir -p "$OUT_DIR"
  cp "$TMPDIR/lib.ts" "$OUT_DIR/lib.ts"
  cp "$TMPDIR/_shim.ts" "$OUT_DIR/_shim.ts"
  echo "Wrote: $OUT_DIR/lib.ts"
  echo "Wrote: $OUT_DIR/_shim.ts"
fi
