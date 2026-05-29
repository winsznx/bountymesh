/* AUTO-GENERATED from packages/sdk/idl/bountymesh.idl by scripts/generate-errors.ts.
 * Run `make sdk-codegen` to regenerate. Do not edit by hand.
 * Drift detection: `make sdk-check-codegen-drift`. */
export const ALL_BOUNTYMESH_ERRORS = [
    'SelfLoop',
    'MarketPaused',
    'RewardBelowMinimum',
    'InsufficientPayment',
    'TitleTooLong',
    'DescriptionTooLong',
    'AcceptanceTooLong',
    'PayloadTooLong',
    'IdSpaceExhausted',
    'BountyNotFound',
    'BountyNotOpen',
    'BountyNotClaimed',
    'BountyNotSubmitted',
    'BountyNotAccepted',
    'AlreadyWithdrawn',
    'Unauthorized',
    'ZeroHashRejected',
    'DeadlineNotReached',
    'NoDeadlineSet',
    'BountyAlreadyTerminal',
    'ReasonTooLong',
];
export const ALL_TRACKS = ['Services', 'Social', 'Economy', 'Open'];
export function isBountyMeshError(s) {
    return typeof s === 'string' && ALL_BOUNTYMESH_ERRORS.includes(s);
}
export function isTrack(s) {
    return typeof s === 'string' && ALL_TRACKS.includes(s);
}
//# sourceMappingURL=errors.generated.js.map