/* AUTO-GENERATED from packages/sdk/idl/bountymesh.idl by scripts/generate-client.sh.
 * Run `make sdk-codegen` to regenerate. Do not edit by hand.
 * Drift detection: `make sdk-check-codegen-drift` (or `npm run check-codegen-drift`).
 *
 * Post-processing applied to sails-js-cli@0.5.1 output (working against @gear-js/api@0.44.2):
 *   1. `HexString` import split out of `@gear-js/api` (re-exported via subpath `/types`).
 *   2. `{ data: { message } }` callback param given `:any` — sails-js-cli predates strict @gear-js/api callback typing; refining the type belongs upstream.
 *   3. Error type renamed to SailsError to avoid shadowing the global Error class.
 *   4. global.d.ts stripped; same string-literal unions re-emitted module-scoped in _shim.ts.
 */

export type SailsError = "SelfLoop" | "MarketPaused" | "RewardBelowMinimum" | "InsufficientPayment" | "TitleTooLong" | "DescriptionTooLong" | "AcceptanceTooLong" | "PayloadTooLong" | "IdSpaceExhausted" | "BountyNotFound" | "BountyNotOpen" | "BountyNotClaimed" | "BountyNotSubmitted" | "BountyNotAccepted" | "AlreadyWithdrawn" | "Unauthorized" | "ZeroHashRejected";

export type TrackEnum = "Services" | "Social" | "Economy" | "Open";
