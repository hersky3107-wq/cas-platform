"use client";

/**
 * User-drawn tarot: spread picker + fanned 78-card tap UI.
 * Positions are 1-based indexes into the seeded shuffle — cards stay face-down
 * until the engine reveals them after session create.
 */
import { TAROT_SPREADS, type TarotSpreadSize } from "@/lib/oracle/engines/draw/conventions";
import { TAROT_SPREAD_LABELS } from "@/lib/oracle/engines/draw/tables";

const SPREAD_COPY: Record<TarotSpreadSize, { title: string; subtitle: string }> = {
  1: { title: "1장", subtitle: "오늘의 카드" },
  3: { title: "3장", subtitle: "과거 · 현재 · 미래" },
  5: { title: "5장", subtitle: "상황 · 방해 · 조언 · 외부 · 결과" },
  10: { title: "10장", subtitle: "켈틱 크로스" },
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
}: {
  spread: TarotSpreadSize;
  pickedPositions: number[];
  onSpread: (spread: TarotSpreadSize) => void;
  onToggle: (position: number) => void;
}) {
  const need = spread;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">스프레드</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TAROT_SPREADS.map((size) => (
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
              <span className="block text-sm font-semibold">{SPREAD_COPY[size].title}</span>
              <span className="mt-0.5 block text-[11px] text-white/45">{SPREAD_COPY[size].subtitle}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">
          카드를 고르세요 · {pickedPositions.length}/{need}
        </p>
        <p className="mt-1 text-[11px] text-white/40">
          {TAROT_SPREAD_LABELS[spread].map((label, i) => `${i + 1}. ${label}`).join("  ·  ")}
        </p>
        <div className="mt-4 overflow-x-auto pb-4">
          <div className="relative mx-auto h-[168px] min-w-[720px] max-w-4xl">
            {Array.from({ length: 78 }, (_, i) => i + 1).map((pos) => {
              const selected = pickedPositions.includes(pos);
              const order = pickedPositions.indexOf(pos);
              const t = (pos - 1) / 77;
              const rotate = (t - 0.5) * 52;
              const x = t * 100;
              return (
                <button
                  key={pos}
                  type="button"
                  aria-label={`카드 위치 ${pos}`}
                  aria-pressed={selected}
                  onClick={() => onToggle(pos)}
                  className={`absolute bottom-0 origin-bottom rounded-md border shadow-md transition ${
                    selected
                      ? "z-20 border-cyan-300/80 ring-2 ring-cyan-300/60"
                      : "z-10 border-white/15 hover:z-30 hover:-translate-y-2"
                  }`}
                  style={{
                    left: `calc(${x}% - 18px)`,
                    transform: `rotate(${rotate}deg)`,
                    width: 36,
                    height: 60,
                    marginBottom: selected ? 18 : 0,
                  }}
                >
                  <TarotBack />
                  {selected ? (
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-cyan-100">
                      {order + 1}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
