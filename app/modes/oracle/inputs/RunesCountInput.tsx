"use client";

const COUNTS = [1, 3, 5] as const;

export default function RunesCountInput({
  count,
  onChange,
}: {
  count: number;
  onChange: (count: number) => void;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">룬 개수</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`rounded-xl border px-3 py-3 text-center transition ${
              count === n
                ? "border-violet-300/55 bg-violet-400/15 text-white"
                : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
            }`}
          >
            <span className="block text-lg font-semibold">{n}</span>
            <span className="text-[11px] text-white/45">{n === 1 ? "한 룬" : `${n}룬`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
