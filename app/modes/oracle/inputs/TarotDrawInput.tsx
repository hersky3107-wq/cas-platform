"use client";

/**
 * User-drawn tarot: spread picker + a visible 78-card grid.
 *
 * The old overlapping 36px fan clipped to empty on the integrated (max-w-3xl)
 * screen — labels showed, nothing to tap. Runes on the same page use a cloth
 * grid; tarot now does too. Positions are 1-based indexes into the seeded
 * shuffle — cards stay face-down until the engine reveals them after create.
 */
import {
  COMPAT_TAROT_LABELS,
  COMPAT_TAROT_SPREADS,
  TAROT_SPREADS,
  type TarotSpreadSize,
} from "@/lib/oracle/engines/draw/conventions";
import { TAROT_SPREAD_LABELS } from "@/lib/oracle/engines/draw/tables";

const SPREAD_COPY: Record<TarotSpreadSize, { title: string; subtitle: string }> = {
  1: { title: "1장", subtitle: "오늘의 카드" },
  3: { title: "3장", subtitle: "과거 · 현재 · 미래" },
  5: { title: "5장", subtitle: "상황 · 방해 · 조언 · 외부 · 결과" },
  10: { title: "10장", subtitle: "켈틱 크로스" },
};

/** 궁합: same grid, relationship positions. */
const COMPAT_SPREAD_COPY: Partial<Record<TarotSpreadSize, { title: string; subtitle: string }>> = {
  3: { title: "3장", subtitle: "본인 · 상대 · 두 사람 사이" },
  5: { title: "5장", subtitle: "본인 · 상대 · 사이 · 걸림돌 · 흐름" },
};

function TarotBack() {
  return (
    <svg viewBox="0 0 100 170" className="h-full w-full" aria-hidden>
      <rect width="100" height="170" rx="8" fill="#1a0533" />
      <rect x="6" y="6" width="88" height="158" rx="7" fill="none" stroke="#c9a84c" strokeWidth="1.4" />
      <rect x="11" y="11" width="78" height="148" rx="6" fill="none" stroke="#c9a84c" strokeOpacity="0.55" strokeWidth="0.9" />
      <circle cx="50" cy="85" r="14" fill="none" stroke="#c9a84c" strokeOpacity="0.7" />
      <circle cx="50" cy="85" r="4" fill="#c9a84c" />
    </svg>
  );
}

export default function TarotDrawInput({
  spread,
  pickedPositions,
  onSpread,
  onToggle,
  compat = false,
}: {
  spread: TarotSpreadSize;
  pickedPositions: number[];
  onSpread: (spread: TarotSpreadSize) => void;
  onToggle: (position: number) => void;
  /** 궁합: relationship spreads (3/5) and position labels; same ritual. */
  compat?: boolean;
}) {
  const need = spread;
  const spreads: readonly TarotSpreadSize[] = compat ? COMPAT_TAROT_SPREADS : TAROT_SPREADS;
  const labels: readonly string[] =
    (compat ? COMPAT_TAROT_LABELS[spread] : undefined) ?? TAROT_SPREAD_LABELS[spread];
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">스프레드</p>
        <div className={`mt-2 grid grid-cols-2 gap-2 ${compat ? "" : "sm:grid-cols-4"}`}>
          {spreads.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onSpread(size)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                spread === size
                  ? "border-violet-300/55 bg-violet-400/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
              }`}
            >
              <span className="block text-sm font-semibold">
                {(compat ? COMPAT_SPREAD_COPY[size] : undefined)?.title ?? SPREAD_COPY[size].title}
              </span>
              <span className="mt-0.5 block text-[11px] text-white/45">
                {(compat ? COMPAT_SPREAD_COPY[size] : undefined)?.subtitle ?? SPREAD_COPY[size].subtitle}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">
          카드를 고르세요 · {pickedPositions.length}/{need}
        </p>
        <p className="mt-1 text-[11px] text-white/40">
          {labels.map((label, i) => `${i + 1}. ${label}`).join("  ·  ")}
        </p>
        <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-[repeat(13,minmax(0,1fr))] sm:gap-1">
          {Array.from({ length: 78 }, (_, i) => i + 1).map((pos) => {
            const selected = pickedPositions.includes(pos);
            const order = pickedPositions.indexOf(pos);
            return (
              <button
                key={pos}
                type="button"
                aria-label={`카드 위치 ${pos}`}
                aria-pressed={selected}
                onClick={() => onToggle(pos)}
                className={`relative aspect-[100/170] w-full overflow-hidden rounded-md border shadow-sm transition ${
                  selected
                    ? "border-cyan-300/80 ring-2 ring-cyan-300/60"
                    : "border-white/20 hover:border-cyan-200/50 hover:-translate-y-0.5"
                }`}
              >
                <TarotBack />
                {selected ? (
                  <span className="absolute inset-x-0 top-0 bg-cyan-400/90 text-center text-[10px] font-bold leading-4 text-[#0a0f1e]">
                    {order + 1}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
