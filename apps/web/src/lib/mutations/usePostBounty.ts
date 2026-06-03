"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Track } from "@/components/primitives/TrackPill";

const PROGRAM_ID = process.env.NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID as
  | `0x${string}`
  | undefined;
const WS_URL = process.env.NEXT_PUBLIC_VARA_WS;

export interface PostBountyArgs {
  title: string;
  description: string;
  acceptance: string;
  reward: bigint;
  track: Track;
  deadline?: number;
}

export interface PostBountyResult {
  bountyId: bigint;
  txHash: string;
  blockHash: string;
}

/**
 * Form-level state for the 3-step post UX:
 *   idle      → ready
 *   signing   → wallet popup is open, awaiting user signature
 *   submitted → tx is in chain but reply not yet final
 *   posted    → bountyId returned, success
 *   error     → transport / signer / contract rejection
 */
export type PostStage =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "submitted"; txHash: string }
  | { kind: "posted"; bountyId: bigint; txHash: string }
  | { kind: "error"; message: string };

export interface UsePostBountyResult {
  stage: PostStage;
  isPending: boolean;
  mutateAsync: (args: PostBountyArgs) => Promise<PostBountyResult>;
  reset: () => void;
}

export function usePostBounty(): UsePostBountyResult {
  const { account, signer, status } = useWallet();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<PostStage>({ kind: "idle" });

  const reset = useCallback(() => setStage({ kind: "idle" }), []);

  const mutateAsync = useCallback(
    async (args: PostBountyArgs): Promise<PostBountyResult> => {
      if (status !== "connected" || !account || !signer) {
        const msg = "Wallet not connected";
        setStage({ kind: "error", message: msg });
        throw new Error(msg);
      }
      if (!PROGRAM_ID) {
        const msg = "NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID not set";
        setStage({ kind: "error", message: msg });
        throw new Error(msg);
      }
      if (!WS_URL) {
        const msg = "NEXT_PUBLIC_VARA_WS not set";
        setStage({ kind: "error", message: msg });
        throw new Error(msg);
      }

      // Lazy-import discipline: chain + SDK modules never touch module-top-
      // level; only loaded when the user actually posts.
      const { GearApi } = await import("@gear-js/api");
      const { BountyMeshClient } = await import("@bountymesh/sdk");

      // Public Vara RPC flaps with 1006 Abnormal Closure under load; archive
      // RPC is more stable. Try public first (lower latency for fresh signers),
      // fall back to archive on init failure.
      const RPC_FALLBACKS = [WS_URL, "wss://archive-rpc.vara.network"];
      let api: Awaited<ReturnType<typeof GearApi.create>> | null = null;
      let lastErr: unknown = null;
      for (const rpc of RPC_FALLBACKS) {
        try {
          api = await GearApi.create({ providerAddress: rpc });
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!api) {
        const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
        const msg = `Could not reach a Vara RPC. Last error: ${detail}`;
        setStage({ kind: "error", message: msg });
        throw new Error(msg);
      }
      try {
        const client = new BountyMeshClient({
          api,
          programId: PROGRAM_ID,
          signer: { address: account.address, signer },
        });

        const stringifyError = (e: unknown): string => {
          if (typeof e === "string") return e;
          if (e instanceof Error) return e.message;
          if (e && typeof e === "object") {
            const obj = e as { message?: unknown; kind?: unknown; error?: unknown };
            if (typeof obj.message === "string") return obj.message;
            if (typeof obj.kind === "string") return obj.kind;
            if (typeof obj.error === "string") return obj.error;
            try {
              return JSON.stringify(e);
            } catch {
              return String(e);
            }
          }
          return String(e);
        };

        const result = await client.postWithCallback(args, {
          onSigning: () => setStage({ kind: "signing" }),
          onSubmitted: (txHash) =>
            setStage({ kind: "submitted", txHash: txHash as string }),
          onError: (err) =>
            setStage({ kind: "error", message: stringifyError(err) }),
        });

        if (!result.ok) {
          const msg = stringifyError(result.error);
          setStage({ kind: "error", message: msg });
          throw new Error(msg);
        }

        const res: PostBountyResult = {
          bountyId: result.value.bountyId,
          txHash: result.txHash as string,
          blockHash: result.blockHash as string,
        };
        setStage({ kind: "posted", bountyId: res.bountyId, txHash: res.txHash });
        void queryClient.invalidateQueries({ queryKey: ["bounties"] });
        return res;
      } finally {
        await api.disconnect();
      }
    },
    [account, signer, status, queryClient],
  );

  const isPending =
    stage.kind === "signing" || stage.kind === "submitted";

  return { stage, isPending, mutateAsync, reset };
}
