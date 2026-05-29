/**
 * Discriminant order of the on-chain `BountyStatus` enum. Used by
 * `BountyTimedOutEvent.lastState` (decoded as u8 to avoid registry metadata).
 */
export const BOUNTY_STATUS_BY_DISCRIMINANT = [
    'Open',
    'Claimed',
    'Submitted',
    'Accepted',
    'Rejected',
    'Cancelled',
    'TimedOut',
    'Revoked',
];
//# sourceMappingURL=types.js.map