import { toast } from "sonner";

function sanitize(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.slice(0, 200);
}

export interface PostToastSuccess {
  bountyId: bigint;
  txHash: string;
}

export function showPostToast(promise: Promise<PostToastSuccess>): void {
  toast.promise(promise, {
    loading: "Posting bounty…",
    success: (data: PostToastSuccess) =>
      `Posted bounty #${data.bountyId.toString()}`,
    error: (err: unknown) => `Failed to post: ${sanitize(err)}`,
  });
}

export interface AcceptToastSuccess {
  bountyId: bigint;
  txHash: string;
}

export function showAcceptToast(promise: Promise<AcceptToastSuccess>): void {
  toast.promise(promise, {
    loading: "Accepting submission…",
    success: (data: AcceptToastSuccess) =>
      `Accepted bounty #${data.bountyId.toString()}`,
    error: (err: unknown) => `Failed to accept: ${sanitize(err)}`,
  });
}
