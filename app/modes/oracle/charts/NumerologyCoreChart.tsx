"use client";

/**
 * 수비학 핵심수 — each core number inside its own polygon: 1 a circle, 2 a
 * vesica, 3 a triangle, 4 a square, 5 a pentagon … 9 a nonagon. Master numbers
 * 11/22/33 get a doubled outline. The digit stays visible inside the shape.
 *
 * Built from oracle_computations.result.numbers — lifePath, birthdayNumber,
 * personalYear, personalMonth, expression, soulUrge, personality all reach the
 * client. expression/soulUrge/personality are null when no Latin name was given.
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MASTER_NUMBERS = new Set([11, 22, 33]);

type Entry = { label: string; value: number };

function parseNumbers(calculation: Json): Entry[] {
  const numbers = isRecord(calculation.numbers) ? calculation.numbers : null;
  if (!numbers) return [];
  const entries: Entry[] = [];
  const push = (label: string, value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) entries.push({ label, value });
  };
  push("라이프 패스", numbers.lifePath);
  push("생일 수", numbers.birthdayNumber);
  push("표현 수", numbers.expression);
  push("영혼 수", numbers.soulUrge);
  push("인격 수", numbers.personality);
  push("개인 연도", numbers.personalYear);
  push("개인 월", numbers.personalMonth);
  return entries;
}

/** Regular polygon points for n sides, centred on (50,50), radius 44. */
function polygonPoints(sides: number, radius = 44, cx = 50, cy = 50): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return points.join(" ");
}

/** Vesica piscis path (two overlapping circles) for the number 2. */
function vesicaPath(cx = 50, cy = 50, r = 30): string {
  const offset = r * 0.55;
  return [
    `M ${cx - offset} ${cy}`,
    `A ${r} ${r} 0 1 1 ${cx + offset} ${cy}`,
    `A ${r} ${r} 0 1 1 ${cx - offset} ${cy}`,
    "Z",
  ].join(" ");
}

function Shape({ value }: { value: number }) {
  const isMaster = MASTER_NUMBERS.has(value);
  const base = value > 9 ? value % 10 || 9 : value; // 11→1, 22→2, 33→3
  const stroke = "currentColor";
  const common = {
    fill: "none" as const,
    stroke,
    strokeWidth: isMaster ? 1.6 : 1.2,
    strokeOpacity: 0.75,
  };

  let shape: React.ReactNode;
  if (base === 1) {
    shape = <circle cx={50} cy={50} r={44} {...common} />;
  } else if (base === 2) {
    shape = <path d={vesicaPath()} {...common} />;
  } else {
    shape = <polygon points={polygonPoints(base)} {...common} />;
  }

  return (
    <svg viewBox="0 0 100 100" className="h-20 w-20 text-cyan-100/80" aria-hidden>
      {isMaster ? (
        // doubled outline for master numbers
        base === 1 ? (
          <circle cx={50} cy={50} r={38} fill="none" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.5" />
        ) : base === 2 ? (
          <path d={vesicaPath(50, 50, 25)} fill="none" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.5" />
        ) : (
          <polygon points={polygonPoints(base, 38)} fill="none" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.5" />
        )
      ) : null}
      {shape}
      <text
        x={50}
        y={54}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-white text-[26px] font-semibold"
      >
        {value}
      </text>
    </svg>
  );
}

export default function NumerologyCoreChart({ calculation }: { calculation: Json }) {
  const entries = parseNumbers(calculation);
  if (!entries.length) return null;

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">핵심 수</h3>
      <p className="mt-1 text-[11px] text-white/40">1=원 · 2=베시카 · 3=삼각 … 9=구각 · 11/22/33=이중선</p>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {entries.map((entry) => (
          <li
            key={entry.label}
            className="flex flex-col items-center rounded-2xl border border-white/10 bg-black/20 px-2 py-3"
          >
            <Shape value={entry.value} />
            <p className="mt-2 text-[11px] text-white/50">{entry.label}</p>
            {MASTER_NUMBERS.has(entry.value) ? (
              <p className="text-[10px] text-amber-200/80">마스터 수</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
