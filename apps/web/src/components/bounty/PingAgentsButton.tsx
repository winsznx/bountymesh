"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet/useWallet";
import { useVaraAgents, type VaraAgent } from "@/lib/queries/useVaraAgents";
import { matchAgents } from "@/lib/a2a/agent-tags";
import { postPingChat } from "@/lib/a2a/pingChat";
import { addressToHex } from "@/lib/format/address";
import type { Bounty } from "@/lib/graphql/types";

interface Props {
  bounty: Bounty;
}

const PINGABLE_STATES = new Set(["Open", "Claimed"]);
const PING_LOCK_KEY_PREFIX = "bountymesh:ping-lock:";
const PING_LOCK_MS = 30 * 60 * 1000;

export function PingAgentsButton({ bounty }: Props) {
  const { account, signer } = useWallet();
  const [open, setOpen] = useState(false);

  // Convert the wallet's SS58 address to the on-chain hex AccountId so we
  // can equality-check against bounty.poster (which the indexer stores as
  // 0x-hex). The lookup caches forever per address.
  const { data: walletHex } = useQuery({
    queryKey: ["wallet-hex", account?.address],
    queryFn: () => addressToHex(account!.address),
    enabled: !!account?.address,
    staleTime: Infinity,
  });

  // Lock state computed once at mount (lazy initializer). The 30-min
  // countdown updates on remount, not via interval — good enough UX for
  // a rate-limit and Date.now() in render trips React 19's purity rule.
  const [lockSnapshot] = useState(() => {
    const expiresAt = readLock(bounty.id);
    const now = typeof window !== "undefined" ? Date.now() : 0;
    return {
      locked: expiresAt > now,
      minsLeft: Math.max(0, Math.ceil((expiresAt - now) / 60_000)),
    };
  });

  const isPoster = walletHex && walletHex.toLowerCase() === bounty.poster.toLowerCase();
  const stateOK = PINGABLE_STATES.has(bounty.status);

  if (!isPoster || !stateOK || !signer) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={lockSnapshot.locked}
        className="inline-flex items-center gap-2 rounded-input border-2 border-abyssal-ink bg-ash-white px-4 py-2 text-sm font-medium text-abyssal-ink transition-colors hover:bg-abyssal-ink hover:text-pure-white disabled:opacity-50 disabled:hover:bg-ash-white disabled:hover:text-abyssal-ink"
      >
        <Send className="h-4 w-4" />
        {lockSnapshot.locked
          ? `Pinged recently — wait ${lockSnapshot.minsLeft} min`
          : "Ping agents about this bounty"}
      </button>
      {open && (
        <PingModal
          bounty={bounty}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PingModal({ bounty, onClose }: { bounty: Bounty; onClose: () => void }) {
  const { account, signer } = useWallet();
  const { data: agents, isLoading } = useVaraAgents();
  const [selected, setSelected] = useState<string[]>(() => {
    const matched = matchAgents({
      track: bounty.track,
      title: bounty.title,
      description: bounty.description ?? "",
    });
    return matched.slice(0, 2);
  });
  const [body, setBody] = useState(() => defaultMessage(bounty, selected));
  const [sending, setSending] = useState(false);

  const allHandles = useMemo(() => (agents ? new Set(agents.map((a) => a.handle)) : new Set<string>()), [agents]);

  const toggleAgent = (handle: string): void => {
    if (selected.includes(handle)) {
      const next = selected.filter((h) => h !== handle);
      setSelected(next);
      setBody(defaultMessage(bounty, next));
      return;
    }
    if (selected.length >= 3) {
      toast.warning("3 agents max per ping");
      return;
    }
    const next = [...selected, handle];
    setSelected(next);
    setBody(defaultMessage(bounty, next));
  };

  const ranked = useMemo(() => rankAgents(bounty, agents ?? []), [bounty, agents]);

  const send = async (): Promise<void> => {
    if (!account || !signer) {
      toast.error("Connect your wallet first.");
      return;
    }
    if (selected.length === 0) {
      toast.error("Pick at least one agent to mention.");
      return;
    }
    setSending(true);
    try {
      const result = await postPingChat({
        senderAddress: account.address,
        senderSigner: signer as Parameters<typeof postPingChat>[0]["senderSigner"],
        mentionHandles: selected,
        body,
      });
      writeLock(bounty.id);
      toast.success("Sent ✓", {
        description: `Chat post #${result.postId} live on agents.vara.network`,
        action: {
          label: "View",
          onClick: () => window.open("https://agents.vara.network/chat", "_blank"),
        },
      });
      onClose();
    } catch (err) {
      toast.error("Ping failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-abyssal-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-card border border-abyssal-ink/10 bg-pure-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-abyssal-ink">
              Invite agents on Vara A2A
            </h2>
            <p className="mt-1 text-xs text-abyssal-ink/60">
              Posts to the on-chain Vara A2A chat as Participant({account?.address.slice(0, 8)}…).
              You pay gas from your own wallet. Limit 3 agents per ping.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-abyssal-ink/40 transition-colors hover:text-abyssal-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="mt-5 space-y-3">
          <div className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
            Selected ({selected.length}/3) — capability-matched first
          </div>
          {isLoading ? (
            <div className="text-xs text-abyssal-ink/40">Loading agent registry…</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ranked.slice(0, 16).map((handle) => {
                const isSel = selected.includes(handle);
                const exists = allHandles.has(handle);
                if (!exists) return null;
                return (
                  <button
                    key={handle}
                    type="button"
                    onClick={() => toggleAgent(handle)}
                    className={`rounded-input border px-2.5 py-1 font-mono text-xs transition-colors ${
                      isSel
                        ? "border-digital-orange bg-digital-orange text-pure-white"
                        : "border-abyssal-ink/20 bg-ash-white text-abyssal-ink hover:border-abyssal-ink"
                    }`}
                  >
                    @{handle}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
            Message
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full rounded-card border border-abyssal-ink/20 bg-pure-white p-3 text-sm text-abyssal-ink placeholder:text-abyssal-ink/40 focus:border-digital-orange focus:outline-none"
            placeholder="Compose the invitation…"
          />
          <div className="text-[10px] text-abyssal-ink/40">{body.length}/2048 chars</div>
        </div>

        <footer className="mt-5 flex items-center justify-between gap-3">
          <a
            href="https://agents.vara.network/chat"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-abyssal-ink/60 transition-colors hover:text-digital-orange"
          >
            Vara A2A chat <ArrowUpRight className="h-3 w-3" />
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-input border border-abyssal-ink/20 bg-ash-white px-4 py-2 text-sm font-medium text-abyssal-ink transition-colors hover:border-abyssal-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || selected.length === 0 || body.length === 0 || body.length > 2048}
              className="inline-flex items-center gap-2 rounded-input bg-digital-orange px-4 py-2 text-sm font-medium text-pure-white transition-colors hover:bg-abyssal-ink disabled:opacity-50 disabled:hover:bg-digital-orange"
            >
              <Send className="h-4 w-4" />
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function rankAgents(bounty: Bounty, agents: VaraAgent[]): string[] {
  const matched = matchAgents({
    track: bounty.track,
    title: bounty.title,
    description: bounty.description ?? "",
  });
  const matchedSet = new Set(matched);
  const rest = agents
    .map((a) => a.handle)
    .filter((h) => !matchedSet.has(h) && h !== "bountymesh" && h !== "bountymesh-rep")
    .sort();
  return [...matched, ...rest];
}

function defaultMessage(bounty: Bounty, agents: string[]): string {
  const rewardVara = formatReward(bounty.reward);
  const mentions = agents.length > 0 ? agents.map((h) => `@${h}`).join(" ") + " " : "";
  return `Open bounty #${bounty.id} on @bountymesh — "${truncate(bounty.title, 80)}" — ${rewardVara} VARA. ${mentions}bountymesh.xyz/bounties/${bounty.id}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function formatReward(atomic: bigint): string {
  const whole = atomic / 1_000_000_000_000n;
  const frac = atomic % 1_000_000_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = (Number(frac) / 1e12).toFixed(3).slice(2).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function lockKey(id: bigint): string {
  return `${PING_LOCK_KEY_PREFIX}${id.toString()}`;
}

function readLock(id: bigint): number {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem(lockKey(id));
  if (!v) return 0;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeLock(id: bigint): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(lockKey(id), String(Date.now() + PING_LOCK_MS));
}
