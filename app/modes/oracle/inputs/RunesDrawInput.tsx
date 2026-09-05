"use client";

/**
 * Rune ritual (FIX 6): two-step flow like tarot — pick the spread, then draw
 * by hand from 24 face-down rune stones scattered on a cloth. Picked stones
 * are 1-based indexes into the seeded shuffle, stored in
 * session_inputs.runes.pickedPositions; which rune hides under which stone is
 * only revealed by the engine after session create.
 */
import { RUNE_SPREADS, type RuneSpreadSize } from "@/lib/oracle/engines/draw/conventions";
import { RUNE_SPREAD_LABELS } from "@/lib/oracle/engines/draw/tables";
import { runePositionKo } from "@/lib/oracle/display-copy";

const SPREAD_COPY: Record<RuneSpreadSize, { title: string; subtitle: string }> = {
  1: { title: "1돌", subtitle: "오늘의 룬" },
  3: { title: "3돌", subtitle: "노른: 과거 · 현재 · 미래" },
  5: { title: "5돌", subtitle: "상황 · 방해 · 조언 · 외부 · 결과" },
};

/** Deterministic scatter so the cloth looks tossed but never reshuffles mid-pick. */
function scatter(position: number) {
  const h = (position * 2654435761) % 1000;
  const col = (position - 1) % 8;
  const row = Math.floor((position - 1) / 8);
  return {
    left: 4 + col * 12 + ((h % 13) - 6) * 0.35,
    top: 8 + row * 30 + (((h >> 3) % 11) - 5) * 1.6,
    rotate: ((h >> 5) % 41) - 20,
  };
}

function StoneFace() {
  return (
    <svg viewBox="0 0 44 56" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="runeStone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b3a44" />
          <stop offset="0.55" stopColor="#26252e" />
          <stop offset="1" stopColor="#1a1922" />
        </linearGradient>
      </defs>
      <path
        d="M22 2c10 0 19 8 20 19 1 12-4 25-13 31-5 3-10 3-15 0C5 46 1 34 2 22 3 10 12 2 22 2Z"
        fill="url(#runeStone)"
        stroke="#57555f"
        strokeWidth="1.2"
      />
      <path d="M9 14c3-5 8-8 13-9" stroke="#6d6a78" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

export default function RunesDrawInput({
  spread,
  pickedPositions,
  onSpread,
  onToggle,
}: {
  spread: RuneSpreadSize;
  pickedPositions: number[];
  onSpread: (spread: RuneSpreadSize) => void;
  onToggle: (position: number) => void;
}) {
  const need = spread;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">스프레드</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {RUNE_SPREADS.map((size) => (
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
          룬돌을 고르세요 · {pickedPositions.length}/{need}
        </p>
        <p className="mt-1 text-[11px] text-white/40">
          {RUNE_SPREAD_LABELS[spread]
            .map((label, i) => `${i + 1}. ${runePositionKo(label)}`)
            .join("  ·  ")}
        </p>
        <div className="mt-3 overflow-x-auto pb-2">
          <div
            className="relative mx-auto h-[132px] min-w-[560px] max-w-3xl rounded-2xl border border-white/10 bg-gradient-to-b from-[#1f1830] to-[#141020] px-2"
            aria-label="엎어 놓은 룬돌 24개"
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((pos) => {
              const selected = pickedPositions.includes(pos);
              const order = pickedPositions.indexOf(pos);
              const s = scatter(pos);
              return (
                <button
                  key={pos}
                  type="button"
                  aria-label={`룬돌 ${pos}`}
                  aria-pressed={selected}
                  onClick={() => onToggle(pos)}
                  className={`absolute transition ${
                    selected ? "z-20 -translate-y-1.5" : "z-10 hover:z-30 hover:-translate-y-1"
                  }`}
                  style={{
                    left: `${s.left}%`,
                    top: s.top,
                    width: 40,
                    height: 52,
                    transform: `rotate(${s.rotate}deg)`,
                  }}
                >
                  <span
                    className={`block h-full w-full rounded-[45%] ${
                      selected ? "drop-shadow-[0_0_10px_rgba(103,232,249,0.45)]" : ""
                    }`}
                  >
                    <StoneFace />
                  </span>
                  {selected ? (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-cyan-400/90 px-1.5 text-[10px] font-bold text-slate-950">
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
