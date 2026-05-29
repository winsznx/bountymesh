import { isBountyMeshError } from './errors.generated.js';
export function adaptErr(raw) {
    if (isBountyMeshError(raw))
        return raw;
    throw new Error(`Unexpected sails-js error shape: ${JSON.stringify(raw)}`);
}
//# sourceMappingURL=errors.js.map