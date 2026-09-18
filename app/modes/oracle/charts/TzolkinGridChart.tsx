"use client";

/**
 * 촐킨 — two day-signs large (birth / today), Maya bar-and-dot tones,
 * Yucatec nawal names. The 20×13 board is a small positional reference
 * underneath: row N is tone N, column N is nawal N. No vertical labels.
 *
 * Built from oracle_computations.result.natal + result.current —
 * { nawal, nawalName, tone }.
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const NAWALS = [
  "Imix", "Ik'", "Ak'b'al", "K'an", "Chikchan", "Kimi", "Manik'", "Lamat",
  "Muluk", "Ok", "Chuwen", "Eb'", "Ben", "Ix", "Men", "K'ib'", "Kaban",
  "Etz'nab'", "Kawak", "Ajaw",
] as const;

type Parsed = {
  birthNawal: number; // 1–20
  birthTone: number; // 1–13
  birthNawalName: string;
  todayNawal: number;
  todayTone: number;
  todayNawalName: string;
};

function parseTzolkin(calculation: Json): Parsed | null {
  const natal = isRecord(calculation.natal) ? calculation.natal : null;
  const current = isRecord(calculation.current) ? calculation.current : null;
  if (!natal || typeof natal.nawal !== "number" || typeof natal.tone !== "number") return null;
  if (!current || typeof current.nawal !== "number" || typeof current.tone !== "number") return null;
  return {
    birthNawal: natal.nawal,
    birthTone: natal.tone,
    birthNawalName: typeof natal.nawalName === "string" ? natal.nawalName : "",
    todayNawal: current.nawal,
    todayTone: current.tone,
    todayNawalName: typeof current.nawalName === "string" ? current.nawalName : "",
  };
}

/** Maya bar-and-dot numeral for 1–13. Dots above bars (dot = 1, bar = 5). */
function MayaNumeral({ value, size }: { value: number; size: "sm" | "lg" }) {
  const bars = Math.floor(value / 5);
  const dots = value % 5;
  const gap = size === "lg" ? "gap-1.5" : "gap-[2px]";
  const dotCls = size === "lg" ? "h-2.5 w-2.5" : "h-[3px] w-[3px]";
  const barCls = size === "lg" ? "h-2 w-14" : "h-[2px] w-3";
  return (
    <span className={`flex flex-col items-center ${gap}`} aria-label={`톤 ${value}`}>
      {dots > 0 ? (
        <span className={`flex ${gap}`}>
          {Array.from({ length: dots }, (_, i) => (
            <span key={i} className={`${dotCls} rounded-full bg-current`} />
          ))}
        </span>
      ) : null}
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className={`${barCls} rounded-full bg-current`} />
      ))}
    </span>
  );
}

function DaySignCard({
  label,
  tone,
  nawalName,
  accent,
}: {
  label: string;
  tone: number;
  nawalName: string;
  accent: "birth" | "today";
}) {
  const ring =
    accent === "birth"
      ? "border-amber-300/50 bg-amber-400/10"
      : "border-cyan-300/50 bg-cyan-400/10";
  const text = accent === "birth" ? "text-amber-100" : "text-cyan-100";
  return (
    <div className={`flex flex-1 flex-col items-center rounded-2xl border px-3 py-5 ${ring}`}>
      <p className={`text-[11px] font-semibold tracking-[0.18em] ${text}`}>{label}</p>
      <p className="mt-3 text-center text-2xl font-semibold leading-tight text-white sm:text-3xl">
        {nawalName || "—"}
      </p>
      <div className={`mt-5 ${text}`}>
        <MayaNumeral value={tone} size="lg" />
      </div>
      <p className="mt-3 text-sm text-white/60">톤 {tone}</p>
    </div>
  );
}

export default function TzolkinGridChart({ calculation }: { calculation: Json }) {
  const parsed = parseTzolkin(calculation);
  if (!parsed) return null;

  const { birthNawal, birthTone, todayNawal, todayTone } = parsed;

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">촐킨</h3>
      <p className="mt-1 text-[11px] text-white/40">출생일과 오늘 · 나왈 + 마야 봉·점 톤</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <DaySignCard
          label="출생"
          tone={birthTone}
          nawalName={parsed.birthNawalName}
          accent="birth"
        />
        <DaySignCard
          label="오늘"
          tone={todayTone}
          nawalName={parsed.todayNawalName}
          accent="today"
        />
      </div>

      {/* Nested rows — not CSS `display:contents` — so tone 5 is visually row 5. */}
      <div className="mt-5" role="img" aria-label="촐킨 260일 위치">
        <p className="mb-2 text-[10px] text-white/35">
          위치 · 가로 나왈 1–20 · 세로 톤 1–13 (1이 위)
        </p>
        <div className="flex flex-col gap-[2px]">
          {Array.from({ length: 13 }, (_, row) => {
            const tone = row + 1;
            return (
              <div key={tone} className="flex items-center gap-[3px]">
                <span
                  className={`w-3 shrink-0 text-right text-[8px] tabular-nums ${
                    tone === birthTone || tone === todayTone ? "text-amber-200" : "text-white/30"
                  }`}
                >
                  {tone}
                </span>
                <div className="grid min-w-0 flex-1 grid-cols-[repeat(20,minmax(0,1fr))] gap-[2px]">
                  {Array.from({ length: 20 }, (_, col) => {
                    const nawal = col + 1;
                    const isBirth = nawal === birthNawal && tone === birthTone;
                    const isToday = nawal === todayNawal && tone === todayTone;
                    return (
                      <div
                        key={nawal}
                        title={`${NAWALS[col]} 톤 ${tone}${isBirth ? " 출생일" : ""}${isToday ? " 오늘" : ""}`}
                        className={`aspect-square rounded-[2px] ${
                          isBirth
                            ? "bg-amber-300"
                            : isToday
                              ? "bg-cyan-300"
                              : "bg-white/10"
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
