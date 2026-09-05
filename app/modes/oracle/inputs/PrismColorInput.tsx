"use client";

import { useEffect, useState } from "react";
import { PRISM_COLORS, type PrismColor } from "@/lib/oracle/engines/prism/tables";

const SWATCH: Record<PrismColor, string> = {
  crimson: "#9B1B30",
  scarlet: "#FF2400",
  amber: "#FFBF00",
  gold: "#D4AF37",
  coral: "#FF7F50",
  rose: "#E8A0BF",
  azure: "#007FFF",
  indigo: "#4B0082",
  violet: "#7F00FF",
  teal: "#008080",
  sage: "#9CAF88",
  slate: "#708090",
  ochre: "#CC7722",
  olive: "#808000",
  bronze: "#CD7F32",
  sand: "#C2B280",
  ivory: "#FFFFF0",
  pearl: "#EAE0C8",
  silver: "#C0C0C0",
  mint: "#98FF98",
  onyx: "#353839",
  plum: "#8E4585",
  navy: "#000080",
  ember: "#C04000",
};

const ROUNDS = [
  { key: "impulse" as const, title: "1. Impulse · 충동", hint: "생각하지 말고 고르세요." },
  { key: "need" as const, title: "2. Need · 필요", hint: "지금 가장 끌리는 색." },
  { key: "identity" as const, title: "3. Identity · 정체성", hint: "나를 나타내는 색." },
];

export type PrismPicks = {
  impulse: PrismColor | null;
  need: PrismColor | null;
  identity: PrismColor | null;
};

function ImpulseCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(5);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const left = Math.max(0, 5 - Math.floor((Date.now() - started) / 1000));
      setSecondsLeft(left);
      if (left === 0) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1 text-xs tabular-nums text-amber-100">
      {secondsLeft}s
    </span>
  );
}

const EMPTY: PrismPicks = { impulse: null, need: null, identity: null };

export default function PrismColorInput({
  value,
  onChange,
}: {
  value: PrismPicks;
  onChange: (next: PrismPicks) => void;
}) {
  const roundIndex =
    value.impulse == null ? 0 : value.need == null ? 1 : value.identity == null ? 2 : 2;
  const round = ROUNDS[roundIndex]!;
  const used = new Set(
    [value.impulse, value.need, value.identity].filter((c): c is PrismColor => c != null),
  );
  const impulsePending = value.impulse == null;

  const pick = (color: PrismColor) => {
    if (used.has(color)) return;
    if (value.impulse == null) onChange({ ...value, impulse: color });
    else if (value.need == null) onChange({ ...value, need: color });
    else if (value.identity == null) onChange({ ...value, identity: color });
  };

  const complete = value.impulse && value.need && value.identity;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">PRISM 색</p>
          <p className="mt-1 text-sm font-semibold text-white">{complete ? "선택 완료" : round.title}</p>
          <p className="mt-0.5 text-[11px] text-white/45">
            {complete ? "세 색이 겹치지 않습니다. 다시 고르려면 초기화하세요." : round.hint}
          </p>
        </div>
        {impulsePending ? <ImpulseCountdown /> : null}
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {PRISM_COLORS.map((color) => {
          const taken = used.has(color);
          const isCurrent =
            (round.key === "impulse" && value.impulse === color) ||
            (round.key === "need" && value.need === color) ||
            (round.key === "identity" && value.identity === color);
          return (
            <button
              key={color}
              type="button"
              disabled={taken && !isCurrent}
              onClick={() => pick(color)}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[10px] capitalize transition disabled:opacity-30 ${
                isCurrent
                  ? "border-cyan-300/70 ring-2 ring-cyan-300/40"
                  : "border-white/10 hover:border-white/30"
              }`}
            >
              <span
                className="block h-8 w-full rounded-md border border-white/15"
                style={{ background: SWATCH[color] }}
              />
              {color}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/55">
        <span>충동 {value.impulse ?? "—"}</span>
        <span>필요 {value.need ?? "—"}</span>
        <span>정체성 {value.identity ?? "—"}</span>
        <button
          type="button"
          onClick={() => onChange(EMPTY)}
          className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-white/70 hover:border-white/40"
        >
          초기화
        </button>
      </div>
    </div>
  );
}
