"use client";

/**
 * 사주 팔자표 — the four pillars, drawn from oracle_computations.
 *
 * Renders as soon as the session is created, before any model has answered:
 * the chart is engine output, not an AI artifact. Every reader sees exactly
 * this table, so it stays on screen while the narratives arrive.
 */
import {
  SAJU_ELEMENT_LABELS,
  parseSajuChart,
  type SajuChartChar,
  type SajuElementKey,
  type SajuEokbu,
} from "@/lib/oracle/saju-chart";
import {
  collapseYongsinInferences,
  formatComputedYongsinLine,
  formatInferredYongsinLine,
  type YongsinInference,
} from "@/lib/oracle/yongsin-guard";

const ELEMENT_CELL: Record<SajuElementKey, string> = {
  wood: "border-emerald-300/35 bg-emerald-400/[0.12] text-emerald-50",
  fire: "border-rose-300/35 bg-rose-400/[0.12] text-rose-50",
  earth: "border-amber-300/35 bg-amber-400/[0.12] text-amber-50",
  metal: "border-slate-200/35 bg-slate-200/[0.12] text-white",
  water: "border-sky-300/35 bg-sky-400/[0.12] text-sky-50",
};

const ELEMENT_BAR: Record<SajuElementKey, string> = {
  wood: "bg-emerald-400",
  fire: "bg-rose-400",
  earth: "bg-amber-400",
  metal: "bg-slate-200",
  water: "bg-sky-400",
};

const ELEMENT_DOT: Record<SajuElementKey, string> = {
  wood: "text-emerald-200",
  fire: "text-rose-200",
  earth: "text-amber-200",
  metal: "text-slate-100",
  water: "text-sky-200",
};

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end pr-2 text-[10px] font-medium leading-tight text-white/40 sm:pr-3 sm:text-[11px]">
      {children}
    </div>
  );
}

function TenGodCell({ value }: { value: string | null }) {
  return (
    <div className="flex items-center justify-center py-1.5 text-[11px] text-cyan-100/70 sm:text-xs">
      {value ?? <span className="text-white/20">·</span>}
    </div>
  );
}

function CharCell({
  char,
  isDayStem,
}: {
  char: SajuChartChar | null;
  isDayStem?: boolean;
}) {
  if (!char) {
    return (
      <div className="flex min-h-[72px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-white/25 sm:min-h-[86px]">
        미상
      </div>
    );
  }
  const tone = char.element ? ELEMENT_CELL[char.element] : "border-white/12 bg-white/[0.04] text-white";
  return (
    <div
      className={[
        "relative flex min-h-[72px] flex-col items-center justify-center rounded-xl border sm:min-h-[86px]",
        tone,
        isDayStem ? "ring-2 ring-cyan-300/60" : "",
      ].join(" ")}
    >
      {isDayStem ? (
        <span className="absolute -top-2 rounded-full bg-cyan-400 px-1.5 py-px text-[9px] font-bold text-[#0a0f1e]">
          일간
        </span>
      ) : null}
      <span className="text-[26px] font-semibold leading-none sm:text-[32px]">{char.hanja}</span>
      <span className="mt-1 text-[11px] opacity-80">{char.hangul}</span>
      <span className="mt-1 text-[10px] opacity-65">
        {char.element ? SAJU_ELEMENT_LABELS[char.element] : "—"}
        {char.yinYang ? (char.yinYang === "yang" ? " 양" : " 음") : ""}
      </span>
    </div>
  );
}

function YongsinPanel({
  eokbu,
  inferences,
}: {
  eokbu: SajuEokbu;
  inferences: YongsinInference[];
}) {
  const inferred = collapseYongsinInferences(inferences);
  const computed = !eokbu.inferenceRequested && eokbu.yongsin !== "없음";
  return (
    <section className="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.06] px-3 py-3 sm:px-4">
      <div className="flex items-end justify-between gap-3">
        <h4 className="text-sm font-semibold text-white">용신</h4>
        <span className="text-[10px] text-white/35">{eokbu.provenance}</span>
      </div>
      {computed ? (
        <p className="mt-2 text-sm leading-relaxed text-cyan-50">
          {formatComputedYongsinLine(eokbu.yongsin)}
        </p>
      ) : inferred.length > 0 ? (
        <div className="mt-2 space-y-1">
          {inferred.map((row) => (
            <p key={`${row.element}-${row.brand ?? "all"}`} className="text-sm leading-relaxed text-amber-50">
              {formatInferredYongsinLine(row.element)}
              {row.brand ? ` (${row.brand})` : ""}
            </p>
          ))}
        </div>
      ) : eokbu.inferenceRequested ? (
        <p className="mt-2 text-sm leading-relaxed text-amber-50">억부로는 판정되지 않음 · AI 판단 요청</p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-cyan-50">{eokbu.summary}</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-white/55">
        {eokbu.inferenceRequested
          ? eokbu.summary
          : `${eokbu.strength} (득령 ${eokbu.deukryeong.relation}, 득지 ${eokbu.deukji.score}, 득세 ${eokbu.deukse.score})`}
        {eokbu.huisin !== "없음" || eokbu.gisin !== "없음"
          ? ` · 희신 ${eokbu.huisin} · 기신 ${eokbu.gisin}`
          : ""}
      </p>
      {eokbu.hourUnknownNote ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">{eokbu.hourUnknownNote}</p>
      ) : null}
    </section>
  );
}

export default function SajuPillarsChart({
  calculation,
  engineVersion,
  yongsinInferences = [],
}: {
  calculation: Record<string, unknown> | null;
  engineVersion?: string | null;
  yongsinInferences?: YongsinInference[];
}) {
  const chart = parseSajuChart(calculation);

  if (!chart) {
    return (
      <article className="rounded-[26px] border border-white/10 bg-[#0d172b] p-6">
        <h3 className="text-lg font-semibold text-white">사주 팔자표</h3>
        <p className="mt-2 text-sm text-amber-100/80">
          생년월일 정보가 부족해 원국을 세울 수 없습니다. 출생 정보를 확인해 주세요.
        </p>
      </article>
    );
  }

  const maxCount = Math.max(1, ...chart.elements.map((entry) => entry.count));

  return (
    <article className="overflow-hidden rounded-[26px] border border-cyan-300/20 bg-[#0d172b] shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <header className="border-b border-white/8 bg-gradient-to-r from-cyan-500/10 to-violet-500/10 px-5 py-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
          계산 결과 · 원국
        </p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h3 className="text-xl font-semibold text-white">사주 팔자표</h3>
          {engineVersion ? (
            <span className="text-[10px] text-white/35">engine {engineVersion}</span>
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          AI가 답하기 전에 계산된 표입니다. 모든 해석자가 바로 이 여덟 글자를 보고 각자 읽습니다.
        </p>
      </header>

      <div className="p-4 sm:p-6">
        <div className="grid grid-cols-[2.6rem_repeat(4,minmax(0,1fr))] gap-x-1.5 gap-y-1 sm:grid-cols-[3.5rem_repeat(4,minmax(0,1fr))] sm:gap-x-3">
          <div />
          {chart.columns.map((column) => (
            <div
              key={`head-${column.key}`}
              className="pb-1 text-center text-[11px] font-semibold text-white/70 sm:text-sm"
            >
              {column.label}
            </div>
          ))}

          <RowLabel>십신</RowLabel>
          {chart.columns.map((column) => (
            <TenGodCell key={`god-stem-${column.key}`} value={column.stem?.tenGod ?? null} />
          ))}

          <RowLabel>천간</RowLabel>
          {chart.columns.map((column) => (
            <CharCell
              key={`stem-${column.key}`}
              char={column.stem}
              isDayStem={column.key === "day"}
            />
          ))}

          <RowLabel>지지</RowLabel>
          {chart.columns.map((column) => (
            <CharCell key={`branch-${column.key}`} char={column.branch} />
          ))}

          <RowLabel>십신</RowLabel>
          {chart.columns.map((column) => (
            <TenGodCell key={`god-branch-${column.key}`} value={column.branch?.tenGod ?? null} />
          ))}

          <RowLabel>십이지</RowLabel>
          {chart.columns.map((column) => (
            <div
              key={`animal-${column.key}`}
              className="flex items-center justify-center pt-0.5 text-[10px] text-white/35 sm:text-[11px]"
            >
              {column.branch?.animal ?? "·"}
            </div>
          ))}
        </div>

        {chart.hourUnknown ? (
          <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-100/85">
            출생 시간이 확정되지 않아 시주가 비어 있습니다. 여섯 글자로 읽으며, 시간에 의존하는
            판단은 비중을 낮춥니다.
          </p>
        ) : null}

        {chart.eokbu ? <YongsinPanel eokbu={chart.eokbu} inferences={yongsinInferences} /> : null}

        <section className="mt-6 border-t border-white/8 pt-5">
          <div className="flex items-end justify-between gap-3">
            <h4 className="text-sm font-semibold text-white">오행 분포</h4>
            <span className="text-[10px] text-white/35">{chart.charCount}자 기준</span>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2 sm:gap-3">
            {chart.elements.map((entry) => (
              <div key={entry.key} className="text-center">
                <div className="flex h-16 items-end justify-center sm:h-20">
                  <div
                    className={`w-full max-w-[34px] rounded-t-md ${ELEMENT_BAR[entry.key]} ${
                      entry.count === 0 ? "opacity-20" : ""
                    }`}
                    style={{ height: `${Math.max(6, (entry.count / maxCount) * 100)}%` }}
                  />
                </div>
                <p className={`mt-2 text-sm font-semibold ${ELEMENT_DOT[entry.key]}`}>
                  {entry.label}
                </p>
                <p className="text-[11px] tabular-nums text-white/45">{entry.count}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </article>
  );
}
