"use client";

import type { Signer } from "@polkadot/types/types";

const VARA_AGENTS_PROGRAM_ID =
  "0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3";
const VARA_RPC_URL = "wss://rpc.vara.network";

export interface PingPostResult {
  postId: string;
  txHash: string;
  blockHash: string;
}

/**
 * Browser-side Chat/Post call.
 *
 * Loads sails-js + sails-js-parser dynamically (keeps initial bundle slim),
 * parses the A2A IDL fetched from /agents_network_client.idl (same-origin
 * static asset), connects a fresh GearApi, builds the call with
 * author=Participant(senderHex) + mentions, signs via the connected
 * extension signer, sends, awaits the response message id.
 *
 * Author is Participant(senderHex), not Application(bountymesh) — the
 * poster pays gas from their own wallet (no voucher), and the chat post
 * is attributed to the poster wallet on the A2A chat surface.
 */
export async function postPingChat(opts: {
  senderAddress: string;
  senderSigner: Signer;
  mentionHandles: string[];
  body: string;
}): Promise<PingPostResult> {
  const [{ GearApi }, { Sails }, { SailsIdlParser }] = await Promise.all([
    import("@gear-js/api"),
    import("sails-js"),
    import("sails-js-parser"),
  ]);

  const idlRes = await fetch("/agents_network_client.idl", { cache: "force-cache" });
  if (!idlRes.ok) throw new Error(`IDL fetch failed: HTTP ${idlRes.status}`);
  const idl = await idlRes.text();

  const api = await GearApi.create({ providerAddress: VARA_RPC_URL });
  await api.isReady;

  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(idl);
  sails.setApi(api);
  sails.setProgramId(VARA_AGENTS_PROGRAM_ID as `0x${string}`);

  // Resolve each handle to its on-chain HandleRef so the contract auth
  // for the recipient list matches the registry.
  const mentions = await Promise.all(
    opts.mentionHandles.map(async (handle: string) => {
      const qb = sails.services.Registry.queries.ResolveHandle(handle);
      const ref = (await qb.call()) as
        | { Participant: `0x${string}` }
        | { Application: `0x${string}` }
        | null;
      if (!ref) throw new Error(`handle "${handle}" not found in A2A registry`);
      return ref;
    }),
  );

  const senderHex: `0x${string}` = opts.senderAddress.startsWith("0x")
    ? (opts.senderAddress as `0x${string}`)
    : await u8aHexFromAddress(opts.senderAddress);

  const author = { Participant: senderHex };

  const tx = sails.services.Chat.functions.Post(opts.body, author, mentions, null);
  tx.withAccount(opts.senderAddress, { signer: opts.senderSigner });
  await tx.calculateGas();
  const sent = await tx.signAndSend();
  const reply = await sent.response();

  await api.disconnect();

  return {
    postId: String(reply),
    txHash: String(sent.txHash),
    blockHash: String(sent.blockHash),
  };
}

async function u8aHexFromAddress(addr: string): Promise<`0x${string}`> {
  const { decodeAddress } = await import("@polkadot/util-crypto");
  const bytes = decodeAddress(addr);
  return ("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}
