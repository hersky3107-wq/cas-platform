"use client";

/**
 * 자미두수 명반 — 12 palaces on the earthly-branch ring (south / 午 up).
 * Built from oracle_computations.result.chart.palaces + siHua + daXian,
 * which previously never reached the UI because publicComputation stripped
 * every `name` key (命, 武曲, …).
 */
import { PALACE_KO } from "@/lib/oracle/display-copy";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type ChartStar = { name: string; category: string; brightness?: string };
type ChartPalace = {
  index: number;
  branch: string;
  stem: string;
  name: string;
  stars: ChartStar[];
};

/** 4×4 ring, 午 at top. Cell = {row, col} on a 4-column grid. */
const BRANCH_CELL: Record<number, { row: number; col: number }> = {
  5: { row: 0, col: 0 }, // 巳
  6: { row: 0, col: 1 }, // 午
  7: { row: 0, col: 2 }, // 未
  8: { row: 0, col: 3 }, // 申
  4: { row: 1, col: 0 }, // 辰
  9: { row: 1, col: 3 }, // 酉
  3: { row: 2, col: 0 }, // 卯
  10: { row: 2, col: 3 }, // 戌
  2: { row: 3, col: 0 }, // 寅
  1: { row: 3, col: 1 }, // 丑
  0: { row: 3, col: 2 }, // 子
  11: { row: 3, col: 3 }, // 亥
};

function asStar(value: unknown): ChartStar | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  return {
    name: value.name,
    category: typeof value.category === "string" ? value.category : "minor",
    brightness: typeof value.brightness === "string" ? value.brightness : undefined,
  };
}

function asPalace(value: unknown): ChartPalace | null {
  if (!isRecord(value) || typeof value.index !== "number" || !Array.isArray(value.stars)) return null;
  const stars = value.stars.map(asStar).filter((star): star is ChartStar => star !== null);
  return {
    index: value.index,
    branch: typeof value.branch === "string" ? value.branch : "",
    stem: typeof value.stem === "string" ? value.stem : "",
    name: typeof value.name === "string" ? value.name : "",
    stars,
  };
}

function starClass(category: string): string {
  if (category === "major") return "text-amber-100";
  if (category === "lucky") return "text-emerald-100/90";
  if (category === "malefic") return "text-rose-100/90";
  return "text-white/55";
}

export default function ZiweiMingbanChart({ calculation }: { calculation: Json }) {
  const chart = isRecord(calculation.chart) ? calculation.chart : null;
  if (!chart || !Array.isArray(chart.palaces)) return null;
  const palaces = chart.palaces.map(asPalace).filter((row): row is ChartPalace => row !== null);
  if (palaces.length !== 12) return null;
  const ju = isRecord(chart.wuXingJu) ? chart.wuXingJu : null;
  const siHua = isRecord(chart.siHua) ? chart.siHua : null;
  const daXian = isRecord(chart.daXian) ? chart.daXian : null;
  const current = isRecord(daXian?.currentDaXian) ? daXian.currentDaXian : null;
  const juName = ju && typeof ju.name === "string" ? ju.name : null;
  const currentLabel =
    current && typeof current.palaceName === "string"
      ? `${PALACE_KO[current.palaceName] ?? current.palaceName}${
          typeof current.ageFrom === "number" && typeof current.ageTo === "number"
            ? ` ${current.ageFrom}–${current.ageTo}세`
            : ""
        }`
      : null;

  const siHuaLine = siHua
    ? [
        typeof siHua.lu === "string" && siHua.lu ? `록 ${siHua.lu}` : null,
        typeof siHua.quan === "string" && siHua.quan ? `권 ${siHua.quan}` : null,
        typeof siHua.ke === "string" && siHua.ke ? `과 ${siHua.ke}` : null,
        typeof siHua.ji === "string" && siHua.ji ? `기 ${siHua.ji}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">명반</h3>
      <p className="mt-1 text-[11px] text-white/40">남쪽(오)이 위 · 십이궁</p>
      <div className="mt-3 grid grid-cols-4 grid-rows-4 gap-1.5">
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/25 px-2 py-3 text-center"
          style={{ gridRow: "2 / 4", gridColumn: "2 / 4" }}
        >
          {juName ? <p className="text-sm font-semibold text-cyan-100">{juName}</p> : null}
          {currentLabel ? (
            <p className="mt-1 text-[11px] leading-relaxed text-white/60">대한 {currentLabel}</p>
          ) : null}
          {siHuaLine ? (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-50/80">사화 {siHuaLine}</p>
          ) : null}
        </div>
        {palaces.map((palace) => {
          const slot = BRANCH_CELL[palace.index];
          if (!slot) return null;
          const majors = palace.stars.filter((star) => star.category === "major");
          const others = palace.stars.filter((star) => star.category !== "major");
          const isMing = palace.name === "命";
          return (
            <div
              key={palace.index}
              className={`min-h-[5.5rem] rounded-xl border px-1.5 py-1.5 ${
                isMing ? "border-amber-300/45 bg-amber-400/[0.08]" : "border-white/10 bg-black/20"
              }`}
              style={{ gridRow: slot.row + 1, gridColumn: slot.col + 1 }}
            >
              <p className="text-[10px] tracking-wide text-cyan-100/75">
                {palace.stem}
                {palace.branch} · {PALACE_KO[palace.name] ?? palace.name}
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-snug text-amber-50">
                {majors.map((star) => star.name).join(" ") || "—"}
              </p>
              {others.length ? (
                <p className="mt-0.5 text-[10px] leading-snug">
                  {others.map((star) => (
                    <span key={`${palace.index}-${star.name}`} className={`${starClass(star.category)} mr-1`}>
                      {star.name}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
