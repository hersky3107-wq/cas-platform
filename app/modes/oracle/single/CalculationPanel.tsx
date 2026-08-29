"use client";

type JsonObject = Record<string, unknown>;

const AXIS_LABELS: Record<string, string> = {
  drive: "추진력",
  stability: "안정성",
  relation: "관계",
  control: "통제력",
  exploration: "탐색",
  reflection: "성찰",
  wood: "목",
  fire: "화",
  earth: "토",
  metal: "금",
  water: "수",
  initiate: "시작",
  consolidate: "정리",
  hold: "유지",
};

const FIELD_LABELS: Record<string, string> = {
  pillars: "사주 원국",
  fiveElements: "오행 분포",
  tenGods: "십성",
  greatLuck: "대운",
  natal: "출생 차트",
  transits: "현재 흐름",
  chart: "명반",
  numbers: "핵심 숫자",
  reading: "이름 풀이",
  draw: "뽑힌 상징",
  current: "현재",
};

function titleFor(key: string): string {
  return FIELD_LABELS[key] ?? AXIS_LABELS[key] ?? key.replaceAll("_", " ");
}

function AxisBars({ title, value }: { title: string; value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rows = Object.entries(value as JsonObject).filter(
    ([, score]) => typeof score === "number" && Number.isFinite(score),
  );
  if (!rows.length) return null;

  const max = Math.max(100, ...rows.map(([, score]) => Math.abs(score as number)));
  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <div className="mt-4 space-y-3">
        {rows.map(([key, raw]) => {
          const score = raw as number;
          const width = Math.max(3, Math.min(100, (Math.abs(score) / max) * 100));
          return (
            <div key={key}>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="text-slate-300">{titleFor(key)}</span>
                <span className="tabular-nums text-cyan-100">{score.toFixed(1)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-400"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-white/35">없음</span>;
  if (typeof value === "boolean") return <span>{value ? "예" : "아니요"}</span>;
  if (typeof value === "number") return <span className="tabular-nums">{value}</span>;
  return <span>{String(value)}</span>;
}

function DataBlock({
  label,
  value,
  depth = 0,
}: {
  label?: string;
  value: unknown;
  depth?: number;
}) {
  if (depth > 4) {
    return (
      <div className="text-xs text-slate-300">
        <Primitive value={JSON.stringify(value)} />
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
        {label ? <h5 className="mb-2 text-xs font-semibold text-cyan-100">{titleFor(label)}</h5> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {value.map((item, index) => (
            <DataBlock key={index} label={`${index + 1}`} value={item} depth={depth + 1} />
          ))}
        </div>
      </section>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonObject);
    return (
      <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
        {label ? <h5 className="mb-3 text-xs font-semibold text-cyan-100">{titleFor(label)}</h5> : null}
        <div className="space-y-2">
          {entries.map(([key, child]) =>
            child && typeof child === "object" ? (
              <DataBlock key={key} label={key} value={child} depth={depth + 1} />
            ) : (
              <div key={key} className="flex items-start justify-between gap-4 border-b border-white/5 py-1.5 last:border-0">
                <span className="text-xs text-slate-400">{titleFor(key)}</span>
                <span className="text-right text-xs text-slate-100">
                  <Primitive value={child} />
                </span>
              </div>
            ),
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="flex justify-between gap-4 rounded-lg bg-white/[0.025] px-3 py-2 text-xs">
      {label ? <span className="text-slate-400">{titleFor(label)}</span> : null}
      <span className="text-slate-100"><Primitive value={value} /></span>
    </div>
  );
}

export type PublicComputation = {
  system: string;
  engineVersion: string | null;
  axes: JsonObject | null;
  calculation: JsonObject | null;
  unreadable: boolean;
};

export default function CalculationPanel({
  computation,
  systemName,
}: {
  computation: PublicComputation;
  systemName: string;
}) {
  const axes = computation.axes;

  return (
    <article className="overflow-hidden rounded-[26px] border border-cyan-300/20 bg-[#0d172b] shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <header className="border-b border-white/8 bg-gradient-to-r from-cyan-500/10 to-violet-500/10 px-5 py-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">계산 결과</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h3 className="text-xl font-semibold text-white">{systemName} 원표</h3>
          {computation.engineVersion ? (
            <span className="text-[10px] text-white/35">engine {computation.engineVersion}</span>
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          AI의 해석보다 먼저 계산된 값입니다. 독자들은 모두 이 동일한 원표를 보고 각자 해석합니다.
        </p>
      </header>

      {computation.unreadable ? (
        <p className="p-5 text-sm text-amber-100">입력 정보가 부족해 이 체계의 계산표를 만들 수 없습니다.</p>
      ) : (
        <div className="space-y-5 p-4 sm:p-5">
          {axes ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <AxisBars title="성향 축" value={axes.traits} />
              <AxisBars title="오행 축" value={axes.elements} />
              <AxisBars title="시기 축" value={axes.phase} />
            </div>
          ) : null}
          {computation.calculation ? (
            <div>
              <h4 className="mb-3 text-sm font-semibold text-white">계산 상세</h4>
              <div className="grid gap-3 lg:grid-cols-2">
                {Object.entries(computation.calculation).map(([key, value]) => (
                  <DataBlock key={key} label={key} value={value} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
