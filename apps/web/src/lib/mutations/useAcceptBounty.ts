"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet/useWallet";

const PROGRAM_ID = process.env.NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID as
  | `0x${string}`
  | undefined;
const WS_URL = process.env.NEXT_PUBLIC_VARA_WS;

export interface AcceptBountyResult {
  bountyId: bigint;
  txHash: string;
  blockHash: string;
}

export function useAcceptBounty() {
  const { account, signer, status } = useWallet();
  const queryClient = useQueryClient();

  return useMutation<AcceptBountyResult, Error, bigint>({
    mutationFn: async (bountyId) => {
      if (status !== "connected" || !account || !signer) {
        throw new Error("Wallet not connected");
      }
      if (!PROGRAM_ID) throw new Error("NEXT_PUBLIC_BOUNTYMESH_PROGRAM_ID not set");
      if (!WS_URL) throw new Error("NEXT_PUBLIC_VARA_WS not set");

      // Lazy-import discipline: chain + SDK modules never touch
      // module-top-level; only loaded when the user actually accepts.
      const { GearApi } = await import("@gear-js/api");
      const { BountyMeshClient } = await import("@bountymesh/sdk");

      const api = await GearApi.create({ providerAddress: WS_URL });
      try {
        const client = new BountyMeshClient({
          api,
          programId: PROGRAM_ID,
          signer: { address: account.address, signer },
        });
        const result = await client.accept(bountyId);
        if (!result.ok) throw new Error(result.error);
        return {
          bountyId,
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
