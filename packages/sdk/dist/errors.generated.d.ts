export type BountyMeshError = 'SelfLoop' | 'MarketPaused' | 'RewardBelowMinimum' | 'InsufficientPayment' | 'TitleTooLong' | 'DescriptionTooLong' | 'AcceptanceTooLong' | 'PayloadTooLong' | 'IdSpaceExhausted' | 'BountyNotFound' | 'BountyNotOpen' | 'BountyNotClaimed' | 'BountyNotSubmitted' | 'BountyNotAccepted' | 'AlreadyWithdrawn' | 'Unauthorized' | 'ZeroHashRejected';
export type Track = 'Services' | 'Social' | 'Economy' | 'Open';
export declare const ALL_BOUNTYMESH_ERRORS: readonly BountyMeshError[];
export declare const ALL_TRACKS: readonly Track[];
export declare function isBountyMeshError(s: unknown): s is BountyMeshError;
export declare function isTrack(s: unknown): s is Track;
//# sourceMappingURL=errors.generated.d.ts.map