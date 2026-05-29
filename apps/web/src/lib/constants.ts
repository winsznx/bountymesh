// Contract-locked constants (mirror programs/bountymesh/app/src/state.rs).
export const MAX_TITLE_LEN = 200;
export const MAX_DESCRIPTION_LEN = 2_000;
export const MAX_ACCEPTANCE_LEN = 1_000;

// Verified-working lower bound on this deploy (0.5 VARA posts succeed —
// see seed-bounties-p32.ts). The contract enforces a deploy-time
// `min_reward` config that the current SDK has no read path for; this
// value reflects the empirical floor we know works.
export const MIN_REWARD_ATOMIC = 500_000_000_000n;

export const VARA_DECIMALS = 12;
export const ATOMIC_PER_VARA = 10n ** BigInt(VARA_DECIMALS);
