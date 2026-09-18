"use client";

/**
 * 숙요 27수 휠 — a ring of 27 mansion ticks. The natal 宿 and today's 宿 are
 * marked and joined by a line whose character reflects the 三九 relation
 * (命業胎 / 栄親 / 友衰 / 安壊 / 危成). Mansions labelled in 한자 + 한글.
 *
 * Built from oracle_computations.result.natal + result.current +
 * result.sukuyouRelation — all already reach the client.
 */
import {
  SUKUYOU_NAME_KO,
  SUKUYOU_SAN_KU_GROUP_KO,
} from "@/lib/oracle/display-copy";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* 27수, 昴-first order, 牛 omitted. Index 0 = 昴宿 = public index 1. */
const MANSIONS: { hanja: string; hangul: string }[] = [
  { hanja: "昴宿", hangul: "묘수" },
  { hanja: "畢宿", hangul: "필수" },
  { hanja: "觜宿", hangul: "자수" },
  { hanja: "參宿", hangul: "삼수" },
  { hanja: "井宿", hangul: "정수" },
  { hanja: "鬼宿", hangul: "귀수" },
  { hanja: "柳宿", hangul: "류수" },
  { hanja: "星宿", hangul: "성수" },
  { hanja: "張宿", hangul: "장수" },
  { hanja: "翼宿", hangul: "익수" },
  { hanja: "軫宿", hangul: "진수" },
  { hanja: "角宿", hangul: "각수" },
  { hanja: "亢宿", hangul: "항수" },
  { hanja: "氐宿", hangul: "저수" },
  { hanja: "房宿", hangul: "방수" },
  { hanja: "心宿", hangul: "심수" },
  { hanja: "尾宿", hangul: "미수" },
  { hanja: "箕宿", hangul: "기수" },
  { hanja: "斗宿", hangul: "두수" },
  { hanja: "女宿", hangul: "여수" },
  { hanja: "虛宿", hangul: "허수" },
  { hanja: "危宿", hangul: "위수" },
  { hanja: "室宿", hangul: "실수" },
  { hanja: "壁宿", hangul: "벽수" },
  { hanja: "奎宿", hangul: "규수" },
  { hanja: "婁宿", hangul: "루수" },
  { hanja: "胃宿", hangul: "위수" },
];

const PAIR_STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  命: { stroke: "text-amber-200", width: 2 },
  業胎: { stroke: "text-violet-300", width: 1.6 },
  栄親: { stroke: "text-emerald-300", width: 1.4 },
  友衰: { stroke: "text-sky-300", dash: "4 3", width: 1.4 },
  安壊: { stroke: "text-rose-300", width: 1.6 },
  危成: { stroke: "text-orange-300", dash: "2 2", width: 1.4 },
};

type Parsed = {
  natalIndex: number; // 1–27
  natalHanja: string;
  natalHangul: string;
  todayIndex: number;
  todayHanja: string;
  todayHangul: string;
  relationName: string;
  relationPair: string;
};

function parseSukuyou(calculation: Json): Parsed | null {
  const natal = isRecord(calculation.natal) ? calculation.natal : null;
  const current = isRecord(calculation.current) ? calculation.current : null;
  const relation = isRecord(calculation.sukuyouRelation) ? calculation.sukuyouRelation : null;
  if (!natal || typeof natal.index !== "number") return null;
  if (!current || typeof current.index !== "number") return null;
  if (!relation || typeof relation.name !== "string" || typeof relation.pair !== "string") return null;
  return {
    natalIndex: natal.index,
    natalHanja: typeof natal.hanja === "string" ? natal.hanja : "",
    natalHangul: typeof natal.hangul === "string" ? natal.hangul : "",
    todayIndex: current.index,
    todayHanja: typeof current.hanja === "string" ? current.hanja : "",
    todayHangul: typeof current.hangul === "string" ? current.hangul : "",
    relationName: relation.name,
    relationPair: relation.pair,
  };
}

const SIZE = 300;
const C = SIZE / 2;
const R_OUT = 138;
const R_TICK = 128;
const R_MARK = 112;
const R_LABEL = 96;

/** Mansion public index (1–27) → angle. 昴(1) at top, advancing clockwise. */
function polar(index: number, radius: number): { x: number; y: number } {
  const step = 360 / 27;
  const deg = -90 + (index - 1) * step;
  const rad = (deg * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

export default function SukuyouWheelChart({ calculation }: { calculation: Json }) {
  const parsed = parseSukuyou(calculation);
  if (!parsed) return null;

  const { natalIndex, todayIndex, relationName, relationPair } = parsed;
  const style = PAIR_STYLE[relationPair] ?? PAIR_STYLE["命"]!;
  const groupKo = SUKUYOU_SAN_KU_GROUP_KO[relationPair] ?? relationPair;
  const nameKo = SUKUYOU_NAME_KO[relationName] ?? relationName;

  const natalP = polar(natalIndex, R_MARK);
  const todayP = polar(todayIndex, R_MARK);

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">27수 휠</h3>
      <p className="mt-1 text-[11px] text-white/40">
        본명숙과 오늘의 숙 · 삼구 {nameKo} ({groupKo})
      </p>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mt-3 h-auto w-full text-white/80"
        role="img"
        aria-label="숙요 27수 휠"
      >
        <circle cx={C} cy={C} r={R_OUT} fill="none" stroke="currentColor" strokeOpacity="0.3" />
        <circle cx={C} cy={C} r={R_TICK} fill="none" stroke="currentColor" strokeOpacity="0.18" />

        {/* 27 ticks */}
        {MANSIONS.map((_, i) => {
          const index = i + 1;
          const a = polar(index, R_OUT);
          const b = polar(index, R_TICK);
          const isNatal = index === natalIndex;
          const isToday = index === todayIndex;
          return (
            <line
              key={index}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              strokeOpacity={isNatal || isToday ? 0.9 : 0.3}
              strokeWidth={isNatal || isToday ? 2 : 1}
            />
          );
        })}

        {/* relation line between natal and today */}
        <line
          x1={natalP.x}
          y1={natalP.y}
          x2={todayP.x}
          y2={todayP.y}
          stroke="currentColor"
          strokeWidth={style.width}
          strokeDasharray={style.dash}
          className={style.stroke}
          strokeOpacity="0.85"
        />

        {/* natal marker */}
        <circle cx={natalP.x} cy={natalP.y} r={7} fill="none" stroke="currentColor" strokeWidth="1.6" className="text-amber-200" />
        <text
          x={natalP.x}
          y={natalP.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-current text-[10px] font-bold text-amber-100"
        >
          명
        </text>

        {/* today marker */}
        <circle cx={todayP.x} cy={todayP.y} r={7} fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.4" className="text-cyan-200" />
        <text
          x={todayP.x}
          y={todayP.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-current text-[10px] font-bold text-cyan-100"
        >
          오
        </text>

        {/* labels for the two marked mansions */}
        {[natalIndex, todayIndex].map((index, i) => {
          const mansion = MANSIONS[index - 1]!;
          const p = polar(index, R_LABEL);
          const isNatal = i === 0;
          return (
            <text
              key={index}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`fill-current text-[10px] ${isNatal ? "text-amber-100" : "text-cyan-100"}`}
            >
              {mansion.hanja}
            </text>
          );
        })}
      </svg>

      <div className="mt-3 space-y-1 text-[12px] text-white/65">
        <p>
          <span className="text-amber-200">본명숙</span>{" "}
          {parsed.natalHanja} {parsed.natalHangul}
        </p>
        <p>
          <span className="text-cyan-200">오늘의 숙</span>{" "}
          {parsed.todayHanja} {parsed.todayHangul}
        </p>
        <p className="text-white/50">
          삼구 {nameKo} · {groupKo}
        </p>
      </div>
    </div>
  );
}
