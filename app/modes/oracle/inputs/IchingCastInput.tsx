"use client";

/**
 * 육효 casting ritual: three coins thrown six times, lines building from the
 * BOTTOM up. Each throw lands 노음(6)/소양(7)/소음(8)/노양(9); changing lines
 * (6/9) flip to build 변괘. The hexagram assembles line by line as it is cast,
 * then 본괘 → 변괘 with names — computed live from the same pure table code the
 * engine uses (hexagramFromYangFlags), so what the user watches is what the
 * server reads.
 *
 * The throw itself is client randomness stored in session_inputs.iching.lines
 * (like tarot's pickedPositions); the session seed stays recorded for the
 * seeded fallback and reproducibility.
 */
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { hexagramFromYangFlags } from "@/lib/oracle/engines/draw";
import type { LineValue } from "@/lib/oracle/engines/draw";

const LINE_VALUE_KO: Record<LineValue, string> = {
  6: "노음",
  7: "소양",
  8: "소음",
  9: "노양",
};

const THROW_LABELS = ["첫째 효", "둘째 효", "셋째 효", "넷째 효", "다섯째 효", "여섯째 효"] as const;

type CoinFace = 2 | 3; // 뒤(음) = 2, 앞(양) = 3 — classic three-coin method.

function throwCoins(): { coins: CoinFace[]; value: LineValue } {
  const coins = Array.from({ length: 3 }, () => (Math.random() < 0.5 ? 2 : 3)) as CoinFace[];
  const value = (coins[0]! + coins[1]! + coins[2]!) as LineValue;
  return { coins, value };
}

function isYang(value: LineValue): boolean {
  return value === 7 || value === 9;
}

function isChanging(value: LineValue): boolean {
  return value === 6 || value === 9;
}

function HexLine({ yang, changing }: { yang: boolean; changing: boolean }) {
  return (
    <span className="relative flex h-2.5 w-24 items-center sm:w-28" aria-hidden>
      {yang ? (
        <span className="h-full w-full rounded-sm bg-amber-100/90" />
      ) : (
        <>
          <span className="h-full w-[42%] rounded-sm bg-amber-100/90" />
          <span className="ml-auto h-full w-[42%] rounded-sm bg-amber-100/90" />
        </>
      )}
      {changing ? (
        <span className="absolute -right-5 text-[11px] font-bold text-rose-300">
          {yang ? "○" : "×"}
        </span>
      ) : null}
    </span>
  );
}

export default function IchingCastInput({
  lines,
  onThrow,
  onReset,
}: {
  /** Cast so far, BOTTOM-UP (효1 first). */
  lines: LineValue[];
  onThrow: (value: LineValue) => void;
  onReset: () => void;
}) {
  const [lastCoins, setLastCoins] = useState<CoinFace[] | null>(null);
  const complete = lines.length === 6;

  const primary = complete ? hexagramFromYangFlags(lines.map(isYang)) : null;
  const resulting = complete
    ? hexagramFromYangFlags(lines.map((value) => (isChanging(value) ? !isYang(value) : isYang(value))))
    : null;
  const hasChanging = lines.some(isChanging);

  const cast = () => {
    if (complete) return;
    const { coins, value } = throwCoins();
    setLastCoins(coins);
    onThrow(value);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">육효 던지기</p>
          <p className="mt-1 text-[11px] text-white/40">
            동전 세 닢을 여섯 번 던져 아래에서부터 효를 쌓습니다. 변효(노음·노양)가 변괘를 만듭니다.
          </p>
        </div>
        {lines.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setLastCoins(null);
              onReset();
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 hover:border-white/25"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> 다시 던지기
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5">
        <div className="flex flex-col-reverse gap-2" aria-label="본괘가 아래에서부터 쌓입니다">
          {Array.from({ length: 6 }, (_, i) => {
            const value = lines[i];
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[11px] tabular-nums text-white/40">
                  {THROW_LABELS[i]}
                </span>
                {value !== undefined ? (
                  <>
                    <HexLine yang={isYang(value)} changing={isChanging(value)} />
                    <span className="ml-4 text-[11px] text-slate-300">
                      {LINE_VALUE_KO[value]}
                      {isChanging(value) ? " · 변효" : ""}
                    </span>
                  </>
                ) : (
                  <span className="h-2.5 w-24 rounded-sm border border-dashed border-white/15 sm:w-28" aria-hidden />
                )}
              </div>
            );
          })}
        </div>

        {!complete ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={cast}
              className="rounded-xl border border-amber-300/45 bg-amber-400/12 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20"
            >
              동전 던지기 · {lines.length + 1}/6
            </button>
            {lastCoins ? (
              <span className="flex items-center gap-1.5" aria-label="마지막 던지기 결과">
                {lastCoins.map((coin, i) => (
                  <span
                    key={i}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold ${
                      coin === 3
                        ? "border-amber-300/60 bg-amber-400/15 text-amber-100"
                        : "border-white/20 bg-white/[0.04] text-white/60"
                    }`}
                  >
                    {coin === 3 ? "앞" : "뒤"}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-sm text-slate-100">
              <span className="font-semibold text-white">
                본괘 {primary!.kingWen} {primary!.hanja}({primary!.hangul})
              </span>
              {hasChanging ? (
                <>
                  <span className="mx-2 text-white/40">→</span>
                  <span className="font-semibold text-white">
                    변괘 {resulting!.kingWen} {resulting!.hanja}({resulting!.hangul})
                  </span>
                </>
              ) : (
                <span className="ml-2 text-[12px] text-white/45">변효 없음 — 괘가 그대로 머뭅니다</span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
