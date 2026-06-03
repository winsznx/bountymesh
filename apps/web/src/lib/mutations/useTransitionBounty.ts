"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet/useWallet";

const PROGRAM_ID = process.env.NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID as
  | `0x${string}`
  | undefined;
const WS_URL = process.env.NEXT_PUBLIC_VARA_WS;

export interface TransitionBountyResult {
  bountyId: bigint;
  txHash: string;
  blockHash: string;
}

/**
 * v2 transition methods. The contract surface is symmetric across the four
 * — same call shape, same return — so they share a single hook factory.
 *
 * Lazy-import discipline: chain + SDK modules never touch module-top-level;
 * only loaded inside the mutationFn so RSC / SSR paths don't pull them.
 */
type TransitionFn = "cancel" | "reject" | "timeout" | "revoke";

interface CancelArgs {
  fn: "cancel";
  bountyId: bigint;
}
interface RejectArgs {
  fn: "reject";
  bountyId: bigint;
  reason: string | null;
}
interface TimeoutArgs {
  fn: "timeout";
  bountyId: bigint;
}
interface RevokeArgs {
  fn: "revoke";
  bountyId: bigint;
}

type TransitionArgs = CancelArgs | RejectArgs | TimeoutArgs | RevokeArgs;

export function useTransitionBounty() {
  const { account, signer, status } = useWallet();
  const queryClient = useQueryClient();

  return useMutation<TransitionBountyResult, Error, TransitionArgs>({
    mutationFn: async (args) => {
      if (status !== "connected" || !account || !signer) {
        throw new Error("Wallet not connected");
      }
      if (!PROGRAM_ID) throw new Error("NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID not set");
      if (!WS_URL) throw new Error("NEXT_PUBLIC_VARA_WS not set");

      const { GearApi } = await import("@gear-js/api");
      const { BountyMeshClient } = await import("@bountymesh/sdk");

      // Public Vara RPC flaps with 1006 Abnormal Closure under load; fall back
      // to archive RPC automatically.
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
        throw new Error(`Could not reach a Vara RPC. Last error: ${detail}`);
      }
      try {
        const client = new BountyMeshClient({
          api,
          programId: PROGRAM_ID,
          signer: { address: account.address, signer },
        });
        let result;
        switch (args.fn) {
          case "cancel":
            result = await client.cancel(args.bountyId);
            break;
          case "reject":
            result = await client.reject(args.bountyId, args.reason);
            break;
          case "timeout":
            result = await client.timeout(args.bountyId);
            break;
          case "revoke":
            result = await client.revoke(args.bountyId);
            break;
        }
        if (!result.ok) throw new Error(result.error);
        return {
          bountyId: args.bountyId,
          txHash: result.txHash,
          blockHash: result.blockHash,
        };
      } finally {
        await api.disconnect();
      }
    },
    onSuccess: (data) => {
      const idStr = data.bountyId.toString();
      void queryClient.invalidateQueries({ queryKey: ["bounty", idStr] });
      void queryClient.invalidateQueries({ queryKey: ["bountyEvents", idStr] });
      void queryClient.invalidateQueries({ queryKey: ["bounties"] });
    },
  });
}

export type { TransitionFn };
