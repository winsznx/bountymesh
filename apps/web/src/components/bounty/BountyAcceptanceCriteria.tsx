import type { Bounty } from "@/lib/graphql/types";

export function BountyAcceptanceCriteria({ bounty }: { bounty: Bounty }) {
  return (
    <section className="space-y-6">
      <Field label="Description">
        {bounty.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
            {bounty.description}
          </p>
        ) : (
          <p className="text-sm italic text-slate-500">No description provided.</p>
        )}
      </Field>

      <Field label="Acceptance criteria">
        {bounty.acceptance ? (
          <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-900/60 p-4 font-mono text-xs leading-relaxed text-slate-200">
            {bounty.acceptance}
          </pre>
        ) : (
          <p className="text-sm italic text-slate-500">No acceptance criteria set.</p>
        )}
      </Field>

      {bounty.deadline !== null && (
        <Field label="Deadline">
          <p className="font-mono text-sm text-slate-300">
            block #{bounty.deadline.toLocaleString()}
          </p>
        </Field>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </h2>
      {children}
    </div>
  );
}
