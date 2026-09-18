"use client";

/**
 * PRISM — the six core axes (추진·안정·관계·통제·탐험·성찰) rendered as an
 * irregular hexagon so the weakest axis reads as a dent, not a number. The
 * identity-colour projection is overlaid as a second, fainter hexagon.
 *
 * Built from oracle_computations.result.prism.coreMatrix + identityProjected,
 * which already reach the client. The 7×7 relationship matrix is NOT computed
 * by the engine (no such field exists in PrismResult), so it is not rendered.
 */
import { PRISM_CORE_KO } from "@/lib/oracle/display-copy";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const AXES = ["drive", "stability", "relation", "control", "exploration", "reflection"] as const;
type Axis = (typeof AXES)[number];

type Parsed = {
  core: Record<Axis, number>;
  identity: Record<Axis, number> | null;
};

function parsePrism(calculation: Json): Parsed | null {
  const prism = isRecord(calculation.prism) ? calculation.prism : null;
  if (!prism || !isRecord(prism.coreMatrix)) return null;
  const core = {} as Record<Axis, number>;
  for (const axis of AXES) {
    const value = prism.coreMatrix[axis];
    if (typeof value !== "number") return null;
    core[axis] = value;
  }
  let identity: Record<Axis, number> | null = null;
  if (isRecord(prism.identityProjected)) {
    const candidate = {} as Record<Axis, number>;
    let ok = true;
    for (const axis of AXES) {
      const value = prism.identityProjected[axis];
      if (typeof value !== "number") {
        ok = false;
        break;
      }
      candidate[axis] = value;
    }
    if (ok) identity = candidate;
  }
  return { core, identity };
}

const SIZE = 280;
const C = SIZE / 2;
const R_MAX = 110;

function polar(axisIndex: number, value: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / AXES.length;
  const radius = (value / 100) * R_MAX;
  return { x: C + radius * Math.cos(angle), y: C + radius * Math.sin(angle) };
}

function hexagonPath(values: Record<Axis, number>): string {
  const points = AXES.map((axis, i) => polar(i, values[axis]));
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
}

export default function PrismCoreHexagonChart({ calculation }: { calculation: Json }) {
  const parsed = parsePrism(calculation);
  if (!parsed) return null;

  const { core, identity } = parsed;
  const weakest = AXES.reduce((a, b) => (core[a] <= core[b] ? a : b));
  const strongest = AXES.reduce((a, b) => (core[a] >= core[b] ? a : b));

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">핵심 축</h3>
      <p className="mt-1 text-[11px] text-white/40">
        여섯 축의 불규칙 육각형 · 가장 낮은 축이 움푹 들어간 곳
      </p>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mt-3 h-auto w-full text-white/80"
        role="img"
        aria-label="PRISM 핵심 축 육각형"
      >
        {/* reference rings */}
        {[25, 50, 75, 100].map((ring) => (
          <polygon
            key={ring}
            points={AXES.map((_, i) => {
              const p = polar(i, ring);
              return `${p.x},${p.y}`;
            }).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeOpacity={ring === 50 ? 0.22 : 0.1}
            strokeDasharray={ring === 50 ? "3 3" : undefined}
          />
        ))}

        {/* axis spokes + labels */}
        {AXES.map((axis, i) => {
          const edge = polar(i, 100);
          const label = polar(i, 118);
          const isWeakest = axis === weakest;
          const isStrongest = axis === strongest;
          return (
            <g key={axis}>
              <line
                x1={C}
                y1={C}
                x2={edge.x}
                y2={edge.y}
                stroke="currentColor"
                strokeOpacity="0.15"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="central"
                className={`fill-current text-[11px] ${
                  isWeakest
                    ? "font-semibold text-rose-300"
                    : isStrongest
                      ? "font-semibold text-emerald-300"
                      : "text-white/55"
                }`}
              >
                {PRISM_CORE_KO[axis] ?? axis}
              </text>
            </g>
          );
        })}

        {/* identity projection — fainter, dashed */}
        {identity ? (
          <path
            d={hexagonPath(identity)}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeDasharray="4 3"
            className="text-cyan-200"
          />
        ) : null}

        {/* core matrix — the main irregular hexagon */}
        <path
          d={hexagonPath(core)}
          fill="currentColor"
          fillOpacity="0.12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeOpacity="0.85"
          className="text-amber-100"
        />

        {/* vertex dots */}
        {AXES.map((axis, i) => {
          const p = polar(i, core[axis]);
          return (
            <circle
              key={axis}
              cx={p.x}
              cy={p.y}
              r={axis === weakest ? 4 : 2.5}
              fill="currentColor"
              className={axis === weakest ? "text-rose-300" : "text-amber-100"}
            />
          );
        })}
      </svg>

      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] text-white/60">
        {AXES.map((axis) => (
          <p key={axis} className="flex items-baseline justify-between gap-1">
            <span className={axis === weakest ? "text-rose-300" : axis === strongest ? "text-emerald-300" : ""}>
              {PRISM_CORE_KO[axis] ?? axis}
            </span>
            <span className="text-white/40">{Math.round(core[axis])}</span>
          </p>
        ))}
      </div>
      {identity ? (
        <p className="mt-2 text-[10px] text-white/35">점선 = 정체성 색 투영</p>
      ) : null}
    </div>
  );
}
