type Props = {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
};

export function StatCard({ label, value, sub, loading = false }: Props) {
  return (
    <div className="space-y-3 rounded-md border border-ash-white bg-ash-white p-6">
      <div className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
        {label}
      </div>
      {loading ? (
        <div className="h-8 w-32 animate-pulse rounded-sm bg-ash-white" />
      ) : (
        <div className="font-mono text-3xl text-abyssal-ink">{value}</div>
      )}
      {sub && (
        <div className="text-xs text-abyssal-ink/40">{sub}</div>
      )}
    </div>
  );
}
