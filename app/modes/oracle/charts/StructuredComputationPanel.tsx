"use client";

/**
 * Placeholder calculation view for systems that do not yet have a dedicated
 * chart. Swap in a real chart by registering it on OracleSystemChart —
 * this panel stays the default so labelled engine output is never a JSON dump.
 */
type Json = Record<string, unknown>;

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function isPlainObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function Scalar({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-white/30">—</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-slate-100">{value ? "yes" : "no"}</span>;
  }
  if (typeof value === "number") {
    const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return <span className="tabular-nums text-slate-100">{rounded}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-slate-100">{value}</span>;
  }
  return <span className="text-white/45">{String(value)}</span>;
}

function Node({ value, depth }: { value: unknown; depth: number }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-white/30">—</span>;
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
      return (
        <span className="text-slate-100">{value.map((item) => String(item)).join(" · ")}</span>
      );
    }
    return (
      <ol className="mt-1 space-y-2">
        {value.map((item, index) => (
          <li
            key={index}
            className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
              {index + 1}
            </p>
            <Node value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (isPlainObject(value)) {
    if (depth >= 4) {
      return <span className="text-white/40 text-xs">…</span>;
    }
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    if (entries.length === 0) return <span className="text-white/30">—</span>;
    return (
      <dl className="mt-1 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(7rem,auto)_1fr]">
        {entries.map(([key, child]) => (
          <div key={key} className="contents">
            <dt className="text-[11px] font-medium text-white/45">{humanizeKey(key)}</dt>
            <dd className="text-sm text-slate-100">
              <Node value={child} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <Scalar value={value} />;
}

export default function StructuredComputationPanel({
  systemName,
  calculation,
  engineVersion,
  unreadable,
}: {
  systemName: string;
  calculation: Json | null;
  engineVersion: string | null;
  unreadable?: boolean;
}) {
  return (
    <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
            계산
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">{systemName}</h3>
        </div>
        {engineVersion ? (
          <span className="text-[10px] text-white/30">{engineVersion}</span>
        ) : null}
      </div>
      {unreadable || !calculation ? (
        <p className="mt-4 text-sm text-white/45">이 체계는 이번 읽기에서 계산되지 않았습니다.</p>
      ) : (
        <div className="mt-4 text-sm">
          <Node value={calculation} depth={0} />
        </div>
      )}
      <p className="mt-5 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-white/35">
        체계별 전용 차트는 이후에 이 자리를 대체합니다. 지금은 엔진이 낸 값을 항목별로 보여
        줍니다.
      </p>
    </article>
  );
}
