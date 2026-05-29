"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  MAX_ACCEPTANCE_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_TITLE_LEN,
  MIN_REWARD_ATOMIC,
  ATOMIC_PER_VARA,
} from "@/lib/constants";
import { usePostBounty } from "@/lib/mutations/usePostBounty";
import { useChainHead } from "@/lib/queries/useChainHead";
import { showPostToast } from "@/lib/tx/toast";
import { formatBlockTarget } from "@/lib/blocks";
import type { Track } from "@/components/primitives/TrackPill";

const TRACKS: Track[] = ["Services", "Economy", "Social", "Open"];

const formSchema = z.object({
  title: z
    .string()
    .min(1, "Required")
    .max(MAX_TITLE_LEN, `Max ${MAX_TITLE_LEN} characters`),
  description: z
    .string()
    .min(1, "Required")
    .max(MAX_DESCRIPTION_LEN, `Max ${MAX_DESCRIPTION_LEN} characters`),
  acceptance: z
    .string()
    .min(1, "Required")
    .max(MAX_ACCEPTANCE_LEN, `Max ${MAX_ACCEPTANCE_LEN} characters`),
  rewardVara: z
    .string()
    .regex(/^\d+(\.\d{1,12})?$/, "Decimal VARA, up to 12 places")
    .refine((s) => parseVaraToAtomic(s) >= MIN_REWARD_ATOMIC, {
      message: `Minimum ${formatAtomicMin()} VARA`,
    }),
  track: z.enum(TRACKS),
  deadlineBlock: z
    .string()
    .optional()
    .refine((s) => !s || /^\d+$/.test(s), { message: "Whole number block height" }),
});

type FormValues = z.infer<typeof formSchema>;

function parseVaraToAtomic(s: string): bigint {
  const [whole, fraction = ""] = s.split(".");
  const padded = (fraction + "0".repeat(12)).slice(0, 12);
  return BigInt(whole) * ATOMIC_PER_VARA + BigInt(padded);
}

function formatAtomicMin(): string {
  const whole = MIN_REWARD_ATOMIC / ATOMIC_PER_VARA;
  const frac = MIN_REWARD_ATOMIC % ATOMIC_PER_VARA;
  if (frac === 0n) return whole.toString();
  return (Number(MIN_REWARD_ATOMIC) / Number(ATOMIC_PER_VARA))
    .toString()
    .replace(/\.?0+$/, "");
}

export function PostBountyForm() {
  const router = useRouter();
  const head = useChainHead();
  const { mutateAsync, isPending, stage } = usePostBounty();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      title: "",
      description: "",
      acceptance: "",
      rewardVara: "",
      track: "Services",
      deadlineBlock: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    const parsed = formSchema.safeParse(values);
    if (!parsed.success) return;

    const promise = mutateAsync({
      title: parsed.data.title,
      description: parsed.data.description,
      acceptance: parsed.data.acceptance,
      reward: parseVaraToAtomic(parsed.data.rewardVara),
      track: parsed.data.track,
      deadline: parsed.data.deadlineBlock
        ? Number(parsed.data.deadlineBlock)
        : undefined,
    }).then((res) => ({ bountyId: res.bountyId, txHash: res.txHash }));

    showPostToast(promise);

    try {
      const res = await promise;
      setTimeout(() => router.push(`/bounties/${res.bountyId.toString()}`), 0);
    } catch {
      // toast already surfaced; stay on form
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6 rounded-md border border-ash-white bg-ash-white p-6"
    >
      <Field id="bm-title" label="Title" error={errors.title?.message}>
        <input
          {...register("title")}
          id="bm-title"
          className="w-full rounded-md border border-abyssal-ink/20 bg-basalt-canvas px-3 py-2 text-sm text-abyssal-ink focus:border-digital-orange focus:outline-none"
          placeholder="One-line summary of the work"
          maxLength={MAX_TITLE_LEN}
        />
      </Field>

      <Field id="bm-description" label="Description" error={errors.description?.message}>
        <textarea
          {...register("description")}
          id="bm-description"
          rows={4}
          className="w-full rounded-md border border-abyssal-ink/20 bg-basalt-canvas px-3 py-2 text-sm text-abyssal-ink focus:border-digital-orange focus:outline-none"
          placeholder="What you want done. Markdown not rendered — write plain text."
          maxLength={MAX_DESCRIPTION_LEN}
        />
      </Field>

      <Field id="bm-acceptance" label="Acceptance criteria" error={errors.acceptance?.message}>
        <textarea
          {...register("acceptance")}
          id="bm-acceptance"
          rows={3}
          className="w-full rounded-md border border-abyssal-ink/20 bg-basalt-canvas px-3 py-2 font-mono text-xs text-abyssal-ink focus:border-digital-orange focus:outline-none"
          placeholder="How the worker proves they did the work."
          maxLength={MAX_ACCEPTANCE_LEN}
        />
      </Field>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          id="bm-reward"
          label="Reward (VARA)"
          error={errors.rewardVara?.message}
          hint={`Min ${formatAtomicMin()} VARA. Reward + gas escrowed at post.`}
        >
          <input
            {...register("rewardVara")}
            id="bm-reward"
            type="text"
            inputMode="decimal"
            className="w-full rounded-md border border-abyssal-ink/20 bg-basalt-canvas px-3 py-2 font-mono text-sm text-abyssal-ink focus:border-digital-orange focus:outline-none"
            placeholder="0.5"
          />
        </Field>

        <Field id="bm-track" label="Track" error={errors.track?.message}>
          <select
            {...register("track")}
            id="bm-track"
            className="w-full rounded-md border border-abyssal-ink/20 bg-basalt-canvas px-3 py-2 text-sm text-abyssal-ink focus:border-digital-orange focus:outline-none"
          >
            {TRACKS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        id="bm-deadline"
        label="Deadline (block height, optional)"
        error={errors.deadlineBlock?.message}
        hint={(() => {
          if (!head) return "Loading current head…";
          const raw = watch("deadlineBlock");
          const targetBlock = raw ? Number(raw) : null;
          if (targetBlock && Number.isFinite(targetBlock) && targetBlock > 0) {
            return formatBlockTarget(head.head, targetBlock);
          }
          return `Current head: #${head.head.toLocaleString()} (~3s per block on Vara)`;
        })()}
      >
        <input
          {...register("deadlineBlock")}
          id="bm-deadline"
          type="text"
          inputMode="numeric"
          className="w-full rounded-md border border-abyssal-ink/20 bg-basalt-canvas px-3 py-2 font-mono text-sm text-abyssal-ink focus:border-digital-orange focus:outline-none"
          placeholder="Leave blank for no deadline"
        />
      </Field>

      {(stage.kind === "signing" ||
        stage.kind === "submitted" ||
        stage.kind === "posted") && <StageStrip stage={stage} />}

      <div className="flex items-center justify-end gap-3 border-t border-ash-white pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-pill bg-digital-orange px-6 py-3 text-sm font-medium text-pure-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stage.kind === "signing"
            ? "Signing…"
            : stage.kind === "submitted"
              ? "Pending…"
              : stage.kind === "posted"
                ? "Posted ✓"
                : "Post bounty"}
        </button>
      </div>
    </form>
  );
}

function StageStrip({
  stage,
}: {
  stage:
    | { kind: "signing" }
    | { kind: "submitted"; txHash: string }
    | { kind: "posted"; bountyId: bigint; txHash: string };
}) {
  const steps: Array<{
    key: "signing" | "submitted" | "posted";
    label: string;
  }> = [
    { key: "signing", label: "Signing" },
    { key: "submitted", label: "Submitted" },
    { key: "posted", label: "Posted" },
  ];
  const activeIdx =
    stage.kind === "signing"
      ? 0
      : stage.kind === "submitted"
        ? 1
        : 2;
  return (
    <div className="space-y-3 rounded-card border border-abyssal-ink/10 bg-pure-white p-4">
      <div className="flex items-center justify-between">
        {steps.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <div key={step.key} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-mono ${
                  done
                    ? "bg-abyssal-ink text-pure-white"
                    : active
                      ? "bg-digital-orange text-pure-white"
                      : "bg-basalt-canvas text-abyssal-ink/50"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={`text-xs font-medium ${
                  done || active ? "text-abyssal-ink" : "text-abyssal-ink/40"
                }`}
              >
                {step.label}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={`mx-1 h-px flex-1 ${
                    done ? "bg-abyssal-ink" : "bg-abyssal-ink/15"
                  }`}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
      {stage.kind !== "signing" && (
        <div className="font-mono text-[11px] text-abyssal-ink/60">
          tx {stage.txHash.slice(0, 10)}…{stage.txHash.slice(-6)}
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-xs font-medium uppercase tracking-wider text-abyssal-ink/60"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-digital-orange">{error}</p>
      ) : hint ? (
        <p className="text-xs text-abyssal-ink/40">{hint}</p>
      ) : null}
    </div>
  );
}
