"use client";

/**
 * Drawn runes rendered LARGE (FIX 6): the Unicode Runic block is text, so the
 * glyph is set at display size — the rune character IS the product. Each stone
 * shows glyph big, name (페후 / Fehu), one line of meaning, its position label,
 * and reversed rotated 180°.
 */
import {
  RUNE_KO,
  RUNE_MEANING_KO,
  runePositionKo,
} from "@/lib/oracle/display-copy";

type DrawnRune = {
  name?: string;
  glyph?: string;
  reversed?: boolean;
  positionLabel?: string;
};

export default function RunesDrawChart({ runes }: { runes: DrawnRune[] }) {
  if (!runes.length) {
    return <p className="text-sm text-white/45">뽑은 룬이 없습니다.</p>;
  }
  const cols =
    runes.length === 1
      ? "grid-cols-1 max-w-[220px] mx-auto"
      : runes.length <= 3
        ? "grid-cols-3"
        : "grid-cols-3 sm:grid-cols-5";

  return (
    <ul className={`grid gap-3 ${cols}`}>
      {runes.map((rune, index) => {
        const name = rune.name ?? "";
        const nameKo = RUNE_KO[name] ?? name;
        const meaning = RUNE_MEANING_KO[name] ?? "";
        const position = rune.positionLabel
          ? runePositionKo(rune.positionLabel)
          : `${index + 1}번째`;
        const reversed = rune.reversed === true;
        return (
          <li
            key={`${name}-${index}`}
            className="flex flex-col items-center rounded-2xl border border-white/10 bg-black/25 px-2 py-4 text-center"
          >
            <p className="text-[11px] font-medium tracking-wide text-cyan-100/80">{position}</p>
            <span
              aria-label={`${nameKo}${reversed ? " 역방향" : ""}`}
              className={`my-3 block font-serif text-6xl leading-none text-amber-100 drop-shadow-[0_0_14px_rgba(252,211,77,0.35)] sm:text-7xl ${
                reversed ? "rotate-180" : ""
              }`}
            >
              {rune.glyph ?? "?"}
            </span>
            <p className="text-sm font-semibold text-white">
              {nameKo}
              {name ? <span className="ml-1 text-[11px] font-normal text-white/45">{name}</span> : null}
            </p>
            {meaning ? (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{meaning}</p>
            ) : null}
            {reversed ? <p className="mt-1 text-[11px] text-amber-200/80">역방향</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
