type Props = {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
};

export function StatCard({ label, value, sub, loading = false }: Props) {
  return (
    <div className="space-y-3 rounded-md border border-slate-800 bg-slate-900/50 p-6">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
      {loading ? (
        <div className="h-8 w-32 animate-pulse rounded-sm bg-slate-800" />
      ) : (
        <div className="font-mono text-3xl text-slate-100">{value}</div>
      )}
      {sub && (
        <div className="text-xs text-slate-500">{sub}</div>
      )}
    </div>
  );
}
