"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
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

export function usePostBounty() {
  const { account, signer, status } = useWallet();
  const queryClient = useQueryClient();

  return useMutation<PostBountyResult, Error, PostBountyArgs>({
    mutationFn: async (args) => {
      if (status !== "connected" || !account || !signer) {
        throw new Error("Wallet not connected");
      }
      if (!PROGRAM_ID) throw new Error("NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID not set");
      if (!WS_URL) throw new Error("NEXT_PUBLIC_VARA_WS not set");

      // Lazy-import per P3.1 discipline: keep browser-only chain + SDK
      // modules out of any module-top-level path that RSC / SSR might
      // touch. All loaded inside the mutationFn — only runs in the
      // browser, only when the user clicks Post.
      const { GearApi } = await import("@gear-js/api");
      const { BountyMeshClient } = await import("@bountymesh/sdk");

      const api = await GearApi.create({ providerAddress: WS_URL });
      try {
        const client = new BountyMeshClient({
          api,
          programId: PROGRAM_ID,
          // InjectedSignerWithAddress shape per Day-0 finding #5 — the
          // SDK requires { address, signer }, not bare injector.signer.
          // Encapsulated here so accept/withdraw hooks reuse the pattern.
          signer: { address: account.address, signer },
        });
        const result = await client.post(args);
        if (!result.ok) throw new Error(result.error);
        return {
          bountyId: result.value.bountyId,
          txHash: result.txHash,
          blockHash: result.blockHash,
        };
      } finally {
        await api.disconnect();
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bounties"] });
    },
  });
}
