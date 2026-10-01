export interface StatusSegment {
  name: string;
  color: string;
  count: number;
}

export function StatusBar({ segments }: { segments: StatusSegment[] }) {
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  return (
    <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-neutral-200 dark:bg-neutral-800">
      {segments.map((s) => (
        <div
          key={s.name}
          title={`${s.name}: ${s.count}`}
          style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
        />
      ))}
    </div>
  );
}
