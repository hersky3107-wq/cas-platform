"use client";

/**
 * One glyph per system, derived from that system's calculation structure —
 * not generic mysticism. Single-weight line art, currentColor, no gradients,
 * no emoji, no photographic imagery. Readable at 28px and 96px.
 */
import type { ReactElement, SVGProps } from "react";
import type { SystemId } from "@/lib/oracle/axes/types";

const SW = 1.6;

type GlyphProps = SVGProps<SVGSVGElement>;

function SajuGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M10 10v28M20 10v28M28 10v28M38 10v28" />
      <path d="M10 18h28M10 30h28" />
    </svg>
  );
}

function ZiweiGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="24" cy="24" r="16" />
      <circle cx="24" cy="24" r="5" />
      <path d="M24 8v11M24 29v11M8 24h11M29 24h11" />
      <path d="M12.7 12.7l7.8 7.8M27.5 27.5l7.8 7.8M35.3 12.7l-7.8 7.8M20.5 27.5l-7.8 7.8" />
    </svg>
  );
}

function AstroGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="24" cy="24" r="16" />
      <circle cx="24" cy="24" r="11" />
      <path d="M8 24h32M24 8v32" />
      <path d="M24 24l10-10M24 24l-7 12M24 24l-12-4" />
    </svg>
  );
}

function TarotGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="12" y="18" width="12" height="18" rx="1.5" transform="rotate(-24 18 27)" />
      <rect x="18" y="16" width="12" height="18" rx="1.5" />
      <rect x="24" y="18" width="12" height="18" rx="1.5" transform="rotate(24 30 27)" />
    </svg>
  );
}

function RunesGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M18 10v28" />
      <path d="M18 14l10 7-10 7" />
    </svg>
  );
}

function IchingGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M12 10h24" />
      <path d="M12 15.6h9.5M26.5 15.6H36" />
      <path d="M12 21.2h24" />
      <path d="M12 26.8h9.5M26.5 26.8H36" />
      <path d="M12 32.4h24" />
      <path d="M12 38h9.5M26.5 38H36" />
    </svg>
  );
}

function NumerologyGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M24 8l13.9 8v16L24 40l-13.9-8V16z" />
      <path d="M24 8v32M10.1 16l27.8 16M38.1 16L10.3 32" />
      <circle cx="24" cy="24" r="3" />
    </svg>
  );
}

function NameGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="10" y="10" width="12" height="12" rx="1" />
      <rect x="26" y="10" width="12" height="12" rx="1" />
      <rect x="10" y="26" width="12" height="12" rx="1" />
      <rect x="26" y="26" width="12" height="12" rx="1" />
      <path d="M22 16h4M22 32h4M16 22v4M32 22v4" />
    </svg>
  );
}

function NinestarGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="9" y="9" width="30" height="30" rx="1" />
      <path d="M19 9v30M29 9v30M9 19h30M9 29h30" />
      <circle cx="24" cy="24" r="2.5" />
    </svg>
  );
}

function SukuyouGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="24" cy="24" r="14" />
      <path d="M24 10a14 14 0 000 28 11 11 0 010-28z" />
    </svg>
  );
}

function TzolkinGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="24" cy="24" r="4" />
      <circle cx="24" cy="24" r="9" strokeDasharray="3.5 3.5" />
      <circle cx="24" cy="24" r="14" strokeDasharray="2.5 4" />
      <circle cx="24" cy="24" r="18" strokeDasharray="1.5 4.5" />
    </svg>
  );
}

function PrismGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M24 8l13.9 24H10.1z" />
      <path d="M24 8v24" />
      <path d="M24 8L16 32M24 8l8 24" />
    </svg>
  );
}

export const SYSTEM_GLYPHS: Record<SystemId, (props: GlyphProps) => ReactElement> = {
  saju: SajuGlyph,
  ziwei: ZiweiGlyph,
  astro: AstroGlyph,
  tarot: TarotGlyph,
  runes: RunesGlyph,
  iching: IchingGlyph,
  numerology: NumerologyGlyph,
  name: NameGlyph,
  ninestar: NinestarGlyph,
  sukuyou: SukuyouGlyph,
  tzolkin: TzolkinGlyph,
  prism: PrismGlyph,
};

export default function SystemGlyph({
  system,
  className,
}: {
  system: SystemId;
  className?: string;
}) {
  const Glyph = SYSTEM_GLYPHS[system];
  return <Glyph className={className} />;
}
