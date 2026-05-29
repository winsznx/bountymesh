import type { Bounty } from "@/lib/graphql/types";

export function BountyAcceptanceCriteria({ bounty }: { bounty: Bounty }) {
  return (
    <section className="space-y-6">
      <Field label="Description">
        {bounty.description ? (
          <p className="whitespace-pre-wrap text-base leading-relaxed text-abyssal-ink/80">
            {bounty.description}
          </p>
        ) : (
          <p className="text-sm italic text-abyssal-ink/40">
            No description provided.
          </p>
        )}
      </Field>

      <Field label="Acceptance criteria">
        {bounty.acceptance ? (
          <pre className="overflow-x-auto rounded-card bg-ash-white p-5 font-mono text-xs leading-relaxed text-abyssal-ink">
            {bounty.acceptance}
          </pre>
        ) : (
          <p className="text-sm italic text-abyssal-ink/40">
            No acceptance criteria set.
          </p>
        )}
      </Field>

      {bounty.deadline !== null && (
        <Field label="Deadline">
          <p className="font-mono text-sm text-abyssal-ink">
            block #{bounty.deadline.toLocaleString()}
          </p>
        </Field>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
        {label}
      </h2>
      {children}
    </div>
  );
}
