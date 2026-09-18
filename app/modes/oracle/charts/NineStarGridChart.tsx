"use client";

/**
 * 구성기학 연반 3×3 (낙서 구궁, 남쪽 위) with 오황살 / 암검살 / 본명살.
 * Built from oracle_computations.result.current.yearBoard — the same board
 * native-chart already sends to the model, which previously never reached UI.
 */
import { COMPASS_KO, ELEMENT_KO } from "@/lib/oracle/display-copy";
import {
  boardRows,
  nineStarDirections,
  type CompassDirection,
  type LuoshuBoard,
  type LuoshuCell,
} from "@/lib/oracle/engines/calendar/luoshu";
import type { FiveElement, NineStarValue } from "@/lib/oracle/engines/calendar/types";

type Json = Record<string, unknown>;

const KILLING_LABELS: Array<{ key: keyof ReturnType<typeof nineStarDirections>["killings"]; label: string }> = [
  { key: "ohwang", label: "오황살" },
  { key: "amgeom", label: "암검살" },
  { key: "honmei", label: "본명살" },
  { key: "honmeiOpposite", label: "본명적살" },
  { key: "sepa", label: "세파" },
  { key: "wolpa", label: "월파" },
];

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asElement(value: unknown): FiveElement | null {
  return value === "wood" || value === "fire" || value === "earth" || value === "metal" || value === "water"
    ? value
    : null;
}

function asStar(value: unknown): NineStarValue | null {
  if (!isRecord(value)) return null;
  if (typeof value.number !== "number" || typeof value.hangul !== "string") return null;
  const element = asElement(value.element);
  if (!element) return null;
  return { number: value.number, hangul: value.hangul, element };
}

function asBoard(value: unknown): LuoshuBoard | null {
  if (!isRecord(value) || !Array.isArray(value.cells) || value.cells.length !== 9) return null;
  const cells: LuoshuCell[] = [];
  for (const entry of value.cells) {
    if (!isRecord(entry) || typeof entry.palace !== "number" || typeof entry.trigram !== "string") return null;
    const star = asStar(entry.star);
    if (!star) return null;
    cells.push({
      palace: entry.palace as LuoshuCell["palace"],
      direction: entry.direction as CompassDirection,
      trigram: entry.trigram,
      star,
    });
  }
  return {
    center: typeof value.center === "number" ? value.center : 5,
    dun: value.dun === "yin" ? "yin" : "yang",
    cells,
  };
}

function flagsFor(cell: LuoshuCell, killings: ReturnType<typeof nineStarDirections>["killings"]): string[] {
  const flags: string[] = [];
  if (cell.direction === killings.ohwang) flags.push("오황살");
  if (cell.direction === killings.amgeom) flags.push("암검살");
  if (cell.direction === killings.honmei) flags.push("본명살");
  if (cell.direction === killings.honmeiOpposite) flags.push("본명적살");
  if (cell.direction === killings.sepa) flags.push("세파");
  return flags;
}

export default function NineStarGridChart({ calculation }: { calculation: Json | null }) {
  if (!calculation) return null;
  const natal = isRecord(calculation.natal) ? calculation.natal : null;
  const current = isRecord(calculation.current) ? calculation.current : null;
  const natalYear = natal && isRecord(natal.year) ? natal.year : null;
  const honmeiNumber = natalYear && typeof natalYear.number === "number" ? natalYear.number : null;
  const yearBoard = current ? asBoard(current.yearBoard) : null;
  const monthBoard = current ? asBoard(current.monthBoard) : null;
  const yearBranch = current && typeof current.yearBranchIndex === "number" ? current.yearBranchIndex : null;
  const monthBranch = current && typeof current.monthBranchIndex === "number" ? current.monthBranchIndex : null;

  if (!yearBoard || honmeiNumber == null || !monthBoard || yearBranch == null || monthBranch == null) {
    return null;
  }

  const dirs = nineStarDirections(yearBoard, monthBoard, honmeiNumber, yearBranch, monthBranch);
  const rows = boardRows(yearBoard);

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">연반 구궁</h3>
      <p className="mt-1 text-[11px] text-white/40">남쪽이 위 · 낙서 순비</p>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {rows.flat().map((cell) => {
          const flags = flagsFor(cell, dirs.killings);
          const hyung = flags.length > 0;
          return (
            <div
              key={cell.palace}
              className={`rounded-xl border px-2 py-2 text-center ${
                hyung ? "border-rose-300/40 bg-rose-400/[0.08]" : "border-white/10 bg-black/20"
              }`}
            >
              <p className="text-[10px] tracking-wide text-cyan-100/75">{COMPASS_KO[cell.direction] ?? cell.direction}</p>
              <p className="mt-1 text-lg font-semibold leading-none text-white">{cell.star.hangul}</p>
              <p className="mt-1 text-[11px] text-white/55">
                {cell.star.number}성 · {ELEMENT_KO[cell.star.element] ?? cell.star.element}
              </p>
              {flags.length ? (
                <p className="mt-1 text-[10px] font-semibold text-rose-100">{flags.join(" · ")}</p>
              ) : null}
            </div>
          );
        })}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-3">
        {KILLING_LABELS.map(({ key, label }) => {
          const dir = dirs.killings[key];
          return (
            <div key={key} className="flex items-baseline justify-between gap-2 border-b border-white/6 py-1">
              <dt className="text-white/50">{label}</dt>
              <dd className="text-slate-100">{dir ? COMPASS_KO[dir] ?? dir : "없음"}</dd>
            </div>
          );
        })}
      </dl>
      {dirs.gilbang.length ? (
        <p className="mt-2 text-[12px] text-emerald-100/80">
          길방 {dirs.gilbang.map((dir) => COMPASS_KO[dir] ?? dir).join(" · ")}
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-white/40">올해 걸을 길방은 없습니다.</p>
      )}
    </div>
  );
}
