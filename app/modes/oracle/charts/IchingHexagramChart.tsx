"use client";

/**
 * 본괘 → 변괘 display (FIX 2/6): the two hexagrams drawn as real line stacks
 * (bottom-up, as cast), changing lines marked ○(노양)/×(노음), with King Wen
 * numbers and names. Works for both user-cast and seeded sessions — it only
 * reads the engine's draw result.
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type HexInfo = {
  kingWen: number | null;
  hanja: string;
  hangul: string;
  lines: boolean[];
};

function readHex(value: unknown): HexInfo | null {
  if (!isRecord(value)) return null;
  const lines = Array.isArray(value.lines)
    ? value.lines.filter((line): line is boolean => typeof line === "boolean")
    : [];
  if (lines.length !== 6) return null;
  return {
    kingWen: typeof value.kingWen === "number" ? value.kingWen : null,
    hanja: typeof value.hanja === "string" ? value.hanja : "",
    hangul: typeof value.hangul === "string" ? value.hangul : "",
    lines,
  };
}

function HexLine({ yang, marker }: { yang: boolean; marker: "yang" | "yin" | null }) {
  return (
    <span className="relative flex h-2 w-16 items-center sm:w-20" aria-hidden>
      {yang ? (
        <span className="h-full w-full rounded-sm bg-amber-100/90" />
      ) : (
        <>
          <span className="h-full w-[42%] rounded-sm bg-amber-100/90" />
          <span className="ml-auto h-full w-[42%] rounded-sm bg-amber-100/90" />
        </>
      )}
      {marker ? (
        <span className="absolute -right-4 text-[10px] font-bold text-rose-300">
          {marker === "yang" ? "○" : "×"}
        </span>
      ) : null}
    </span>
  );
}

function Hexagram({
  hex,
  title,
  changing,
}: {
  hex: HexInfo;
  title: string;
  /** 1-based changing positions (본괘 only). */
  changing: Set<number>;
}) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="flex flex-col-reverse gap-1.5 rounded-xl border border-white/10 bg-black/25 px-5 py-4">
        {hex.lines.map((yang, i) => (
          <HexLine
            key={i}
            yang={yang}
            marker={changing.has(i + 1) ? (yang ? "yang" : "yin") : null}
          />
        ))}
      </div>
      <figcaption className="text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{title}</p>
        <p className="mt-0.5 text-sm font-semibold text-white">
          {hex.kingWen !== null ? `${hex.kingWen} ` : ""}
          {hex.hanja}
          {hex.hangul ? ` (${hex.hangul})` : ""}
        </p>
      </figcaption>
    </figure>
  );
}

export default function IchingHexagramChart({ calculation }: { calculation: Json }) {
  const draw = isRecord(calculation.draw) ? calculation.draw : null;
  const primary = readHex(draw?.primary);
  const resulting = readHex(draw?.resulting);
  if (!primary) {
    return <p className="text-sm text-white/45">괘 정보가 없습니다.</p>;
  }
  const changingPositions = new Set(
    Array.isArray(draw?.changingPositions)
      ? draw.changingPositions.filter((p): p is number => typeof p === "number")
      : [],
  );
  const changed = changingPositions.size > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
        <Hexagram hex={primary} title="본괘" changing={changingPositions} />
        {resulting && changed ? (
          <>
            <span className="text-xl text-white/40" aria-hidden>
              →
            </span>
            <Hexagram hex={resulting} title="변괘" changing={new Set()} />
          </>
        ) : null}
      </div>
      <p className="mt-3 text-center text-[11px] text-white/45">
        {changed
          ? `변효 ${changingPositions.size}개 — ○는 노양, ×는 노음이 변하는 자리입니다.`
          : "변효 없음 — 괘가 그대로 머뭅니다."}
      </p>
    </div>
  );
}
