import { isBountyMeshError, type BountyMeshError } from './errors.generated.js';

export function adaptErr(raw: unknown): BountyMeshError {
  if (isBountyMeshError(raw)) return raw;
  throw new Error(`Unexpected sails-js error shape: ${JSON.stringify(raw)}`);
}
