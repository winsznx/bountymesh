/**
 * Protocol-native visual primitives — every shape exists to explain a
 * specific BountyMesh contract behavior. Reused across the site so the same
 * geometry recurs and the visual vocabulary becomes recognizable.
 *
 * Color discipline:
 *   abyssal-ink     immutable / past / settled
 *   cyber-violet    state · execution · verification (≤ 15% of the page)
 *   digital-orange  value · reward · escrow · action
 *   pixel-glare     proof match · highlight band
 *   ash-white       information surface
 *   pure-white      input surface (forms, hash strings)
 *   basalt-canvas   page bg
 */

import { Lock, Unlock, Check, X, ArrowRight } from "lucide-react";

// ──────────────────────────────────────────────────────────── StateNode ──

export type WorkflowState =
  | "Posted"
  | "Claimed"
  | "Submitted"
  | "Accepted"
  | "Settled";

export interface StateNodeProps {
  state: WorkflowState;
  stage: "past" | "current" | "future";
  caption?: string;
  badge?: string;
  txHash?: string;
}

const STATE_LABEL: Record<WorkflowState, string> = {
  Posted: "POSTED",
  Claimed: "CLAIMED",
  Submitted: "SUBMITTED",
  Accepted: "ACCEPTED",
  Settled: "SETTLED",
};

/** Single workflow state — the recurring atomic unit. */
export function StateNode({
  state,
  stage,
  caption,
  badge,
  txHash,
}: StateNodeProps) {
  const STAGE_STYLES: Record<
    StateNodeProps["stage"],
    { container: string; dot: string; label: string; caption: string }
  > = {
    past: {
      container: "bg-abyssal-ink border-abyssal-ink",
      dot: "bg-pure-white",
      label: "text-pure-white",
      caption: "text-pure-white/60",
    },
    current: {
      container: "bg-cyber-violet border-cyber-violet",
      dot: "bg-pixel-glare",
      label: "text-pure-white",
      caption: "text-pure-white/80",
    },
    future: {
      container:
        "bg-pure-white border-abyssal-ink/30 border-dashed",
      dot: "bg-abyssal-ink/30",
      label: "text-abyssal-ink/60",
      caption: "text-abyssal-ink/40",
    },
  };
  const s = STAGE_STYLES[stage];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className={`relative flex h-[132px] min-w-0 flex-col justify-between rounded-[28px] border-2 px-3 py-4 lg:h-[148px] lg:px-4 xl:px-5 ${s.container}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`}
          />
          {badge && (
            <span className="truncate rounded-input bg-digital-orange px-2 py-0.5 text-[10px] font-mono font-medium text-pure-white">
              {badge}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <div className={`font-display text-[20px] leading-[0.94] tracking-heading-sm lg:text-[22px] xl:text-[24px] ${s.label}`}>
            {STATE_LABEL[state]}
          </div>
          {caption && (
            <div className={`text-[11px] leading-snug lg:text-[11px] xl:text-xs ${s.caption}`}>
              {caption}
            </div>
          )}
        </div>
      </div>
      {txHash && (
        <a
          href={`https://vara.subscan.io/extrinsic/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="px-2 font-mono text-[10px] text-abyssal-ink/40 transition-colors hover:text-digital-orange"
        >
          tx {txHash}
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── WorkflowRail ──

/** Horizontal connector between two StateNodes. Solid orange if past, dashed if future. */
export function RailSegment({
  active,
  width = "flex-1",
}: {
  active: boolean;
  width?: string;
}) {
  return (
    <div className={`flex items-center ${width}`} aria-hidden>
      <div
        className={`h-0.5 flex-1 ${
          active
            ? "bg-digital-orange"
            : "border-t-2 border-dashed border-abyssal-ink/20"
        }`}
      />
      <ArrowRight
        className={`h-4 w-4 ${active ? "text-digital-orange" : "text-abyssal-ink/30"}`}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────── ProtocolDiagram (hero) ──

/**
 * Hero workflow diagram. Renders the 5 lifecycle states with sample data so
 * the visual itself communicates the entire protocol at a glance.
 */
export function ProtocolDiagram() {
  const states: Array<StateNodeProps & { id: WorkflowState }> = [
    {
      id: "Posted",
      state: "Posted",
      stage: "past",
      caption: "poster locks reward",
      badge: "0.5 VARA",
      txHash: "0x71cb…e18b",
    },
    {
      id: "Claimed",
      state: "Claimed",
      stage: "past",
      caption: "worker wins the lock",
      txHash: "0xb14f…3702",
    },
    {
      id: "Submitted",
      state: "Submitted",
      stage: "current",
      caption: "envelope hash on chain",
      txHash: "0x88e1…00ad",
    },
    {
      id: "Accepted",
      state: "Accepted",
      stage: "future",
      caption: "poster signs receipt",
    },
    {
      id: "Settled",
      state: "Settled",
      stage: "future",
      caption: "worker pulls reward",
      badge: "+0.5 VARA",
    },
  ];

  return (
    <div className="rounded-[36px] bg-ash-white p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
          Bounty lifecycle
        </div>
        <div className="rounded-input bg-pure-white px-3 py-1 font-mono text-[10px] text-abyssal-ink/60">
          bounty #1
        </div>
      </div>

      {/* Desktop horizontal rail */}
      <div className="hidden grid-cols-5 gap-4 lg:grid xl:gap-6">
        {states.map((s, i) => (
          <DiagramStep key={s.id} index={i} total={states.length} state={s} />
        ))}
      </div>

      {/* Mobile + tablet vertical rail */}
      <div className="flex flex-col gap-3 lg:hidden">
        {states.map((s) => (
          <div key={s.id} className="flex flex-col gap-2">
            <StateNode {...s} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagramStep({
  index,
  total,
  state,
}: {
  index: number;
  total: number;
  state: StateNodeProps;
}) {
  const isLast = index === total - 1;
  const railActive = state.stage === "past";
  return (
    <div className="relative min-w-0">
      <StateNode {...state} />
      {!isLast && (
        <div
          className="absolute top-[58px] -right-6 z-10 hidden w-7 items-center xl:flex"
          aria-hidden
        >
          <RailSegment active={railActive} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── EscrowVault ──

/**
 * Visual of the escrow contract holding VARA. Used in the escrow section
 * to show locked → released state transitions.
 */
export function EscrowVault({
  locked,
  amount,
  label,
}: {
  locked: boolean;
  amount: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`relative flex h-[140px] w-[140px] flex-col items-center justify-center rounded-card border-2 ${
          locked
            ? "border-abyssal-ink bg-abyssal-ink text-pure-white"
            : "border-digital-orange bg-pure-white text-abyssal-ink"
        }`}
      >
        {/* Lock icon top */}
        <div
          className={`absolute -top-3 flex h-6 w-6 items-center justify-center rounded-full ${
            locked
              ? "bg-pure-white text-abyssal-ink"
              : "bg-digital-orange text-pure-white"
          }`}
        >
          {locked ? (
            <Lock className="h-3 w-3" aria-hidden />
          ) : (
            <Unlock className="h-3 w-3" aria-hidden />
          )}
        </div>
        <div className="font-display text-[36px] leading-[0.94] tracking-heading-sm">
          {amount}
        </div>
        <div
          className={`mt-1 text-[10px] font-medium uppercase tracking-wider ${
            locked ? "text-pure-white/60" : "text-abyssal-ink/40"
          }`}
        >
          VARA
        </div>
      </div>
      <div className="text-center text-xs font-medium text-abyssal-ink/70">
        {label}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── ClaimRunner ──

/**
 * Visual of a single worker attempting Claim. Composes into ClaimRace
 * where multiple runners converge on a bounty marker.
 */
function WorkerMarker({
  address,
  status,
}: {
  address: string;
  status: "racing" | "won" | "lost";
}) {
  const STATUS_STYLES: Record<typeof status, string> = {
    racing: "border-cyber-violet bg-pure-white text-abyssal-ink",
    won: "border-digital-orange bg-digital-orange text-pure-white",
    lost: "border-abyssal-ink/20 bg-pure-white text-abyssal-ink/40 line-through",
  };
  return (
    <div
      className={`flex h-10 items-center gap-2 rounded-input border-2 px-3 font-mono text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-current" />
      {address}
    </div>
  );
}

export function ClaimRace() {
  return (
    <div className="space-y-6 rounded-card bg-ash-white p-8">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
          Claim race · block #33,364,617
        </div>
        <div className="rounded-input border border-abyssal-ink/20 bg-pure-white px-3 py-1 font-mono text-[10px] text-abyssal-ink/60">
          first-finalized wins
        </div>
      </div>

      <div className="space-y-3">
        {/* Workers attempting Claim */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <WorkerMarker address="0xa2d2…0b1f" status="won" />
          <WorkerMarker address="0x4c91…aa10" status="lost" />
          <WorkerMarker address="0xfb22…cc04" status="lost" />
        </div>

        {/* Convergence arrow */}
        <div className="flex justify-center py-3" aria-hidden>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-abyssal-ink text-pure-white">
            <ArrowRight className="h-5 w-5 -rotate-90" />
          </div>
        </div>

        {/* Bounty target */}
        <div className="flex items-center justify-between rounded-input bg-pure-white px-5 py-3">
          <span className="text-sm font-medium text-abyssal-ink">
            Bounty #1 · Services
          </span>
          <span className="rounded-input bg-digital-orange px-3 py-0.5 font-mono text-xs font-medium text-pure-white">
            0.5 VARA
          </span>
        </div>

        <div className="rounded-input border-2 border-abyssal-ink bg-abyssal-ink px-5 py-3 text-pure-white">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium uppercase tracking-wider opacity-80">
              Worker lock
            </span>
            <span className="font-mono">0xa2d2…0b1f</span>
          </div>
          <div className="mt-1 text-[10px] opacity-60">
            other claims rejected with{" "}
            <span className="font-mono">BountyNotOpen</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────── ProofEnvelope ──

export function ProofEnvelope({
  hash,
  bountyId,
}: {
  hash: string;
  bountyId: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-card bg-pure-white p-6">
      {/* Top — hash band */}
      <div className="flex items-center justify-between rounded-input bg-abyssal-ink px-4 py-2 text-pure-white">
        <span className="text-[10px] font-medium uppercase tracking-wider opacity-60">
          sha256
        </span>
        <span className="font-mono text-xs">{hash}</span>
      </div>

      {/* Envelope body — canonical-JSON preview */}
      <div className="space-y-1 rounded-card bg-ash-white p-4 font-mono text-[11px] leading-relaxed text-abyssal-ink/80">
        <div>
          <span className="text-abyssal-ink/40">{"{"}</span>
        </div>
        <div className="pl-3">
          <span className="text-cyber-violet">&quot;bounty_id&quot;</span>
          <span className="text-abyssal-ink/40">:</span>{" "}
          <span className="text-digital-orange">{bountyId}</span>
          <span className="text-abyssal-ink/40">,</span>
        </div>
        <div className="pl-3">
          <span className="text-cyber-violet">&quot;output&quot;</span>
          <span className="text-abyssal-ink/40">: </span>
          <span className="text-abyssal-ink/40">{"{ ... }"}</span>
          <span className="text-abyssal-ink/40">,</span>
        </div>
        <div className="pl-3">
          <span className="text-cyber-violet">&quot;adapter&quot;</span>
          <span className="text-abyssal-ink/40">: </span>
          <span className="text-abyssal-ink">&quot;groq&quot;</span>
        </div>
        <div>
          <span className="text-abyssal-ink/40">{"}"}</span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── HashCompare ──

/** Verification block: on-chain commit vs locally recomputed sha256. */
export function HashCompare({
  match,
  onChain,
  computed,
}: {
  match: boolean;
  onChain: string;
  computed: string;
}) {
  return (
    <div
      className={`relative space-y-4 rounded-card p-6 ${
        match
          ? "bg-pixel-glare text-abyssal-ink"
          : "bg-pure-white text-abyssal-ink"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full ${
            match
              ? "bg-abyssal-ink text-pixel-glare"
              : "bg-digital-orange text-pure-white"
          }`}
        >
          {match ? (
            <Check className="h-5 w-5" aria-hidden />
          ) : (
            <X className="h-5 w-5" aria-hidden />
          )}
        </div>
        <div className="font-display text-xl tracking-heading-sm">
          {match ? "VERIFIED" : "HASH MISMATCH"}
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium uppercase tracking-wider opacity-60">
            on chain
          </span>
          <span className="font-mono">{onChain}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium uppercase tracking-wider opacity-60">
            local sha256
          </span>
          <span className="font-mono">{computed}</span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────── TrackLane ──

/**
 * Horizontal routing lane labelled by track. Bounty markers ride the lane
 * left → right. Multiple lanes stack into the Tracks section.
 */
export function TrackLane({
  track,
  description,
  markers,
}: {
  track: string;
  description: string;
  markers: { id: string; reward: string; label: string }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-card bg-ash-white px-6 py-5 md:grid-cols-[200px_1fr] md:items-center md:gap-8">
      <div className="space-y-1">
        <div className="font-display text-2xl tracking-heading-sm text-abyssal-ink">
          {track.toUpperCase()}
        </div>
        <div className="text-xs text-abyssal-ink/60">{description}</div>
      </div>

      <div className="relative flex min-w-0 items-center" aria-hidden>
        {/* Lane line */}
        <div className="absolute inset-x-0 top-1/2 hidden h-px -translate-y-1/2 bg-abyssal-ink/15 md:block" />
        {/* Markers */}
        <div className="relative z-10 flex w-full min-w-0 flex-wrap items-center justify-start gap-3 md:flex-nowrap md:justify-between">
          {markers.map((m) => (
            <div
              key={m.id}
              className="flex max-w-full min-w-0 items-center gap-2 rounded-input border border-abyssal-ink/20 bg-pure-white px-3 py-1.5 text-xs"
            >
              <span className="font-mono text-abyssal-ink/60">{m.id}</span>
              <span className="min-w-0 truncate font-medium text-abyssal-ink">
                {m.label}
              </span>
              <span className="rounded-input bg-digital-orange px-2 py-0.5 font-mono text-[10px] font-medium text-pure-white">
                {m.reward}
              </span>
            </div>
          ))}
        </div>
        <ArrowRight className="ml-3 h-4 w-4 text-abyssal-ink/40" />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── EcosystemMap ──

interface EcosystemNode {
  label: string;
  role: string;
  surface: "ash" | "abyssal" | "violet" | "orange";
}

/**
 * Ecosystem map — flat node graph of protocol participants. Used in the
 * community section to show who participates in the bounty lifecycle.
 */
export function EcosystemMap() {
  const left: EcosystemNode[] = [
    { label: "POSTER", role: "wallet · signs Post / Accept", surface: "ash" },
    { label: "AGENT", role: "wallet · signs Claim / Submit / Withdraw", surface: "ash" },
  ];
  const center: EcosystemNode[] = [
    {
      label: "CONTRACT",
      role: "Sails program · 9 methods · escrow",
      surface: "violet",
    },
  ];
  const right: EcosystemNode[] = [
    {
      label: "INDEXER",
      role: "Postgres + PostGraphile · live projection",
      surface: "ash",
    },
    {
      label: "SDK",
      role: "@bountymesh/sdk · TypeScript client",
      surface: "ash",
    },
    {
      label: "A2A HUB",
      role: "Vara Agent Network · registered app",
      surface: "ash",
    },
  ];

  const surfaceClass: Record<EcosystemNode["surface"], string> = {
    ash: "bg-ash-white text-abyssal-ink",
    abyssal: "bg-abyssal-ink text-pure-white",
    violet: "bg-cyber-violet text-pure-white",
    orange: "bg-digital-orange text-pure-white",
  };

  const Card = ({ node }: { node: EcosystemNode }) => (
    <div className={`space-y-1 rounded-card px-5 py-4 ${surfaceClass[node.surface]}`}>
      <div className="font-display text-lg tracking-heading-sm">
        {node.label}
      </div>
      <div className="text-[11px] leading-snug opacity-80">{node.role}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* CONTRACT card sits at top — the hub everyone interacts with */}
      <div className="mx-auto max-w-md">
        {center.map((n) => (
          <Card key={n.label} node={n} />
        ))}
      </div>

      {/* Two columns of participants below — equal-width, no overflow */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-abyssal-ink/40">
            Wallet signers
          </div>
          {left.map((n) => (
            <Card key={n.label} node={n} />
          ))}
        </div>
        <div className="space-y-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-abyssal-ink/40">
            Off-chain surface
          </div>
          {right.map((n) => (
            <Card key={n.label} node={n} />
          ))}
        </div>
      </div>
    </div>
  );
}
