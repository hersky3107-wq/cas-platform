"use client";

/**
 * 점성술 네이탈 휠 — 12-sign outer ring, 12-house inner band, planet glyphs at
 * their true ecliptic degrees, aspect lines across the centre, ASC/MC axes.
 *
 * Built from oracle_computations.result.natal — bodies/angles/houses/aspects
 * all reach the client. When birth time is unknown the engine returns
 * angles:null + houses:null, so the house band and axes disappear instead of
 * being faked. The two 12-fold rings start at different points; that offset IS
 * the ascendant and is left visible as information.
 */
import { BODY_KO, SIGN_KO } from "@/lib/oracle/display-copy";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* ── glyphs ─────────────────────────────────────────────────────────── */

const SIGN_GLYPH: Record<string, string> = {
  Aries: "♈",
  Taurus: "♉",
  Gemini: "♊",
  Cancer: "♋",
  Leo: "♌",
  Virgo: "♍",
  Libra: "♎",
  Scorpio: "♏",
  Sagittarius: "♐",
  Capricorn: "♑",
  Aquarius: "♒",
  Pisces: "♓",
};

const BODY_GLYPH: Record<string, string> = {
  Sun: "☉",
  Moon: "☽",
  Mercury: "☿",
  Venus: "♀",
  Mars: "♂",
  Jupiter: "♃",
  Saturn: "♄",
  Uranus: "♅",
  Neptune: "♆",
  Pluto: "♇",
  TrueNode: "☊",
  SouthNode: "☋",
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

const ASPECT_STYLE: Record<string, { stroke: string; dash?: string; label: string }> = {
  conjunction: { stroke: "text-amber-200", label: "합" },
  sextile: { stroke: "text-sky-300", dash: "3 3", label: "섹스타일" },
  square: { stroke: "text-rose-300", label: "스퀘어" },
  trine: { stroke: "text-emerald-300", label: "트라인" },
  opposition: { stroke: "text-rose-300", label: "오포지션" },
};

/* ── parsing ────────────────────────────────────────────────────────── */

type Body = {
  key: string;
  longitude: number;
  sign: string;
  degreeInSign: number;
  retrograde: boolean;
  house: number | null;
};

type Parsed = {
  timeKnown: boolean;
  bodies: Body[];
  angles: { ascendant: number; midheaven: number } | null;
  houses: number[] | null;
  aspects: { a: string; b: string; type: string }[];
};

const SIGN_ORDER = Object.keys(SIGN_KO);

/** Ecliptic degrees from the stored longitude, or sign + degree-in-sign. */
function bodyLongitude(value: Json): number | null {
  if (typeof value.longitude === "number" && Number.isFinite(value.longitude)) {
    return ((value.longitude % 360) + 360) % 360;
  }
  if (typeof value.sign === "string" && typeof value.degreeInSign === "number") {
    const index = SIGN_ORDER.indexOf(value.sign);
    if (index >= 0 && Number.isFinite(value.degreeInSign)) {
      return (index * 30 + value.degreeInSign + 360) % 360;
    }
  }
  return null;
}

function parseNatal(calculation: Json): Parsed | null {
  const natal = isRecord(calculation.natal) ? calculation.natal : null;
  if (!natal || !isRecord(natal.bodies)) return null;

  const bodies: Body[] = [];
  for (const [key, value] of Object.entries(natal.bodies)) {
    if (!isRecord(value)) continue;
    const longitude = bodyLongitude(value);
    if (longitude == null) continue;
    bodies.push({
      key,
      longitude,
      sign: typeof value.sign === "string" ? value.sign : "",
      degreeInSign: typeof value.degreeInSign === "number" ? value.degreeInSign : 0,
      retrograde: value.retrograde === true,
      house: typeof value.house === "number" ? value.house : null,
    });
  }
  if (!bodies.length) return null;

  const anglesRaw = isRecord(natal.angles) ? natal.angles : null;
  const angles =
    anglesRaw &&
    typeof anglesRaw.ascendant === "number" &&
    typeof anglesRaw.midheaven === "number"
      ? { ascendant: anglesRaw.ascendant, midheaven: anglesRaw.midheaven }
      : null;

  const housesRaw = Array.isArray(natal.houses) ? natal.houses : null;
  const houses =
    housesRaw && housesRaw.length === 12 && housesRaw.every((n) => typeof n === "number")
      ? (housesRaw as number[])
      : null;

  const aspects: Parsed["aspects"] = [];
  if (Array.isArray(natal.aspects)) {
    for (const entry of natal.aspects) {
      if (!isRecord(entry)) continue;
      if (typeof entry.a !== "string" || typeof entry.b !== "string" || typeof entry.type !== "string")
        continue;
      aspects.push({ a: entry.a, b: entry.b, type: entry.type });
    }
  }

  return {
    timeKnown: natal.timeKnown === true,
    bodies,
    angles,
    houses,
    aspects,
  };
}

/* ── geometry helpers ───────────────────────────────────────────────── */

const SIZE = 320;
const C = SIZE / 2;
const R_SIGN_OUT = 150;
const R_SIGN_IN = 132;
const R_HOUSE_OUT = 130;
const R_HOUSE_IN = 108;
const R_PLANET = 92;
const R_ASPECT = 88;

/** Ecliptic longitude → SVG point. 0° Aries at left, counter-clockwise. */
function polar(longitude: number, radius: number): { x: number; y: number } {
  const rad = ((180 - longitude) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

/* ── component ──────────────────────────────────────────────────────── */

export default function AstrologyNatalWheelChart({ calculation }: { calculation: Json }) {
  const parsed = parseNatal(calculation);
  if (!parsed) return null;

  const { timeKnown, bodies, angles, houses, aspects } = parsed;
  const byKey = new Map(bodies.map((b) => [b.key, b]));

  // Spread planets that share a degree so glyphs don't overlap.
  const sorted = [...bodies].sort((a, b) => a.longitude - b.longitude);
  const placed = new Map<string, number>();
  let lastLon = -Infinity;
  for (const body of sorted) {
    let lon = body.longitude;
    if (lon - lastLon < 6) lon = lastLon + 6;
    placed.set(body.key, lon);
    lastLon = lon;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">네이탈 휠</h3>
      <p className="mt-1 text-[11px] text-white/40">
        {timeKnown ? "상승점 기준 · 하우스 있음" : "시간 미상 — 하우스·앵글 없음"}
      </p>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mt-3 h-auto w-full text-white/80"
        role="img"
        aria-label="점성술 네이탈 휠"
      >
        {/* outer sign ring */}
        <circle cx={C} cy={C} r={R_SIGN_OUT} fill="none" stroke="currentColor" strokeOpacity="0.35" />
        <circle cx={C} cy={C} r={R_SIGN_IN} fill="none" stroke="currentColor" strokeOpacity="0.35" />
        {Array.from({ length: 12 }, (_, i) => {
          const start = i * 30;
          const mid = start + 15;
          const glyph = SIGN_GLYPH[Object.keys(SIGN_GLYPH)[i]!] ?? "";
          const p = polar(mid, (R_SIGN_OUT + R_SIGN_IN) / 2);
          const lineA = polar(start, R_SIGN_OUT);
          const lineB = polar(start, R_SIGN_IN);
          return (
            <g key={i}>
              <line
                x1={lineA.x}
                y1={lineA.y}
                x2={lineB.x}
                y2={lineB.y}
                stroke="currentColor"
                strokeOpacity="0.3"
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-current text-[13px]"
                opacity="0.8"
              >
                {glyph}
              </text>
            </g>
          );
        })}

        {/* house band — only when birth time is known */}
        {timeKnown && houses ? (
          <g>
            <circle cx={C} cy={C} r={R_HOUSE_OUT} fill="none" stroke="currentColor" strokeOpacity="0.3" />
            <circle cx={C} cy={C} r={R_HOUSE_IN} fill="none" stroke="currentColor" strokeOpacity="0.3" />
            {houses.map((cusp, i) => {
              const next = houses[(i + 1) % 12]!;
              const mid = (cusp + (((next - cusp + 360) % 360) || 30) / 2) % 360;
              const p = polar(mid, (R_HOUSE_OUT + R_HOUSE_IN) / 2);
              const lineA = polar(cusp, R_HOUSE_OUT);
              const lineB = polar(cusp, R_HOUSE_IN);
              return (
                <g key={i}>
                  <line
                    x1={lineA.x}
                    y1={lineA.y}
                    x2={lineB.x}
                    y2={lineB.y}
                    stroke="currentColor"
                    strokeOpacity="0.25"
                  />
                  <text
                    x={p.x}
                    y={p.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-current text-[9px]"
                    opacity="0.55"
                  >
                    {ROMAN[i]}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {/* ASC / MC axes breaking the rim */}
        {timeKnown && angles ? (
          <g stroke="currentColor" strokeOpacity="0.7">
            {[angles.ascendant, angles.midheaven].map((lon, i) => {
              const a = polar(lon, R_SIGN_OUT + 2);
              const b = polar(lon, R_HOUSE_IN - 4);
              const label = i === 0 ? "ASC" : "MC";
              const lp = polar(lon, R_SIGN_OUT + 12);
              return (
                <g key={label}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth="1.4" />
                  <text
                    x={lp.x}
                    y={lp.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-current text-[9px] font-semibold"
                    opacity="0.8"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {/* aspect lines across the centre */}
        <g>
          {aspects.map((aspect, i) => {
            const a = byKey.get(aspect.a);
            const b = byKey.get(aspect.b);
            if (!a || !b) return null;
            const style = ASPECT_STYLE[aspect.type];
            if (!style) return null;
            const pa = polar(placed.get(aspect.a)!, R_ASPECT);
            const pb = polar(placed.get(aspect.b)!, R_ASPECT);
            return (
              <line
                key={i}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke="currentColor"
                strokeOpacity={aspect.type === "conjunction" ? 0.5 : 0.32}
                strokeDasharray={style.dash}
                className={style.stroke}
              />
            );
          })}
        </g>

        {/* planet glyphs */}
        {bodies.map((body) => {
          const lon = placed.get(body.key)!;
          const p = polar(lon, R_PLANET);
          const glyph = BODY_GLYPH[body.key] ?? "•";
          return (
            <g key={body.key}>
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-current text-[14px]"
              >
                {glyph}
              </text>
              {body.retrograde ? (
                <text
                  x={p.x + 9}
                  y={p.y - 7}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-current text-[8px] text-rose-300"
                >
                  R
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-white/60 sm:grid-cols-3">
        {bodies.map((body) => (
          <li key={body.key} className="flex items-baseline justify-between gap-2">
            <span>
              {BODY_GLYPH[body.key] ?? ""} {BODY_KO[body.key] ?? body.key}
              {body.retrograde ? <span className="ml-0.5 text-rose-300">R</span> : null}
            </span>
            <span className="text-white/40">
              {SIGN_KO[body.sign] ?? body.sign} {Math.floor(body.degreeInSign)}°
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
