/* AUTO-GENERATED from packages/sdk/idl/bountymesh.idl by scripts/generate-errors.ts.
 * Run `make sdk-codegen` to regenerate. Do not edit by hand.
 * Drift detection: `make sdk-check-codegen-drift`. */

export type BountyMeshError =
  | 'SelfLoop'
  | 'MarketPaused'
  | 'RewardBelowMinimum'
  | 'InsufficientPayment'
  | 'TitleTooLong'
  | 'DescriptionTooLong'
  | 'AcceptanceTooLong'
  | 'PayloadTooLong'
  | 'IdSpaceExhausted'
  | 'BountyNotFound'
  | 'BountyNotOpen'
  | 'BountyNotClaimed'
  | 'BountyNotSubmitted'
  | 'BountyNotAccepted'
  | 'AlreadyWithdrawn'
  | 'Unauthorized'
  | 'ZeroHashRejected';

export type Track = 'Services' | 'Social' | 'Economy' | 'Open';

export const ALL_BOUNTYMESH_ERRORS: readonly BountyMeshError[] = [
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
] as const;

export const ALL_TRACKS: readonly Track[] = ['Services', 'Social', 'Economy', 'Open'] as const;

export function isBountyMeshError(s: unknown): s is BountyMeshError {
  return typeof s === 'string' && (ALL_BOUNTYMESH_ERRORS as readonly string[]).includes(s);
}

export function isTrack(s: unknown): s is Track {
  return typeof s === 'string' && (ALL_TRACKS as readonly string[]).includes(s);
}
