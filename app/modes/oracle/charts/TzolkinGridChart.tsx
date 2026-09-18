"use client";

/**
 * 촐킨 20×13 — the sacred calendar as a grid: 20 nawal columns × 13 tone rows.
 * Birth day cell and today's cell are highlighted. Tones are rendered as Maya
 * bar-and-dot numerals (dot = 1, bar = 5), the authentic notation.
 *
 * Built from oracle_computations.result.natal + result.current — both already
 * reach the client with { nawal, nawalName, tone }.
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

/** Maya bar-and-dot numeral for 1–13. */
function MayaNumeral({ value }: { value: number }) {
  const bars = Math.floor(value / 5);
  const dots = value % 5;
  return (
    <span className="flex flex-col items-center gap-[2px]" aria-label={`톤 ${value}`}>
      <span className="flex gap-[2px]">
        {Array.from({ length: dots }, (_, i) => (
          <span key={i} className="h-[3px] w-[3px] rounded-full bg-current" />
        ))}
      </span>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="h-[2px] w-4 rounded-full bg-current" />
      ))}
    </span>
  );
}

export default function TzolkinGridChart({ calculation }: { calculation: Json }) {
  const parsed = parseTzolkin(calculation);
  if (!parsed) return null;

  const { birthNawal, birthTone, todayNawal, todayTone } = parsed;

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">촐킨 20×13</h3>
      <p className="mt-1 text-[11px] text-white/40">
        20 나왈 × 13 톤 · 출생일과 오늘
      </p>

      <div className="mt-3 overflow-x-auto">
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `auto repeat(20, minmax(0, 1fr))` }}
          role="grid"
          aria-label="촐킨 260일 달력"
        >
          {/* header row: nawal names */}
          <div />
          {NAWALS.map((name, i) => (
            <div
              key={name}
              className={`flex items-end justify-center pb-1 text-[8px] leading-none ${
                i + 1 === birthNawal || i + 1 === todayNawal ? "text-cyan-200" : "text-white/35"
              }`}
              style={{ writingMode: "vertical-rl" }}
            >
              {name}
            </div>
          ))}

          {/* 13 tone rows */}
          {Array.from({ length: 13 }, (_, row) => {
            const tone = row + 1;
            return (
              <div key={tone} className="contents">
                {/* row label: Maya numeral */}
                <div
                  className={`flex items-center justify-center pr-1 ${
                    tone === birthTone || tone === todayTone ? "text-amber-200" : "text-white/40"
                  }`}
                >
                  <MayaNumeral value={tone} />
                </div>
                {Array.from({ length: 20 }, (_, col) => {
                  const nawal = col + 1;
                  const isBirth = nawal === birthNawal && tone === birthTone;
                  const isToday = nawal === todayNawal && tone === todayTone;
                  return (
                    <div
                      key={nawal}
                      role="gridcell"
                      aria-label={`${NAWALS[col]} 톤 ${tone}${isBirth ? " 출생일" : ""}${isToday ? " 오늘" : ""}`}
                      className={`aspect-square rounded-[3px] border ${
                        isBirth
                          ? "border-amber-300/80 bg-amber-400/25"
                          : isToday
                            ? "border-cyan-300/80 bg-cyan-400/25"
                            : "border-white/8 bg-black/20"
                      }`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 space-y-1 text-[12px] text-white/65">
        <p>
          <span className="text-amber-200">출생</span>{" "}
          톤 {birthTone} · {parsed.birthNawalName}
        </p>
        <p>
          <span className="text-cyan-200">오늘</span>{" "}
          톤 {todayTone} · {parsed.todayNawalName}
        </p>
      </div>
    </div>
  );
}
