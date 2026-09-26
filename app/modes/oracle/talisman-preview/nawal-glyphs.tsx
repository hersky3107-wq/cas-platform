/**
 * Geometric 촐킨 nawal marks for the 부적. Form only.
 * 24×24 grid, one stroke weight, circles / lines / dots / arcs.
 * Not traditional Maya day-sign artwork and not Dreamspell icons.
 */
import type { ReactNode } from 'react'
import { TZOLKIN_NAWAL } from '@/lib/oracle/engines/calendar/tables'

export const NAWAL_GLYPH_SIZE = 24
const SW = 1.6

function Dot({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r="1.4" fill="currentColor" stroke="none" />
}

const GLYPHS: readonly ReactNode[] = [
  // 1 Imix — concentric wells
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <Dot x={12} y={12} />
  </>,
  // 2 Ik' — facing arcs
  <>
    <path d="M9 4 A7 8 0 0 0 9 20" />
    <path d="M15 4 A7 8 0 0 1 15 20" />
  </>,
  // 3 Ak'b'al — circle cut by a chord
  <>
    <circle cx="12" cy="12" r="8" />
    <line x1="4" y1="12" x2="20" y2="12" />
  </>,
  // 4 K'an — diamond + seed
  <>
    <polygon points="12,3 21,12 12,21 3,12" />
    <Dot x={12} y={12} />
  </>,
  // 5 Chikchan — two stacked waves
  <>
    <path d="M4 8 C8 3 10 13 14 8 S20 3 20 8" />
    <path d="M4 16 C8 11 10 21 14 16 S20 11 20 16" />
  </>,
  // 6 Kimi — circle with a vertical cut
  <>
    <circle cx="12" cy="12" r="8" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </>,
  // 7 Manik' — chevron on a base
  <>
    <polyline points="5,18 12,5 19,18" />
    <line x1="7" y1="18" x2="17" y2="18" />
  </>,
  // 8 Lamat — four axes
  <>
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </>,
  // 9 Muluk — three nested arcs
  <>
    <path d="M4 16 A8 8 0 0 1 20 16" />
    <path d="M6 16 A6 6 0 0 1 18 16" />
    <path d="M8 16 A4 4 0 0 1 16 16" />
  </>,
  // 10 Ok — two overlapping rings
  <>
    <circle cx="9" cy="12" r="6" />
    <circle cx="15" cy="12" r="6" />
  </>,
  // 11 Chuwen — open hash
  <>
    <line x1="7" y1="5" x2="7" y2="19" />
    <line x1="17" y1="5" x2="17" y2="19" />
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
  </>,
  // 12 Eb' — diagonal path with ticks
  <>
    <line x1="5" y1="19" x2="19" y2="5" />
    <line x1="8" y1="13" x2="12" y2="17" />
    <line x1="12" y1="7" x2="16" y2="11" />
  </>,
  // 13 Ben — three uprights
  <>
    <line x1="7" y1="18" x2="7" y2="10" />
    <line x1="12" y1="18" x2="12" y2="5" />
    <line x1="17" y1="18" x2="17" y2="10" />
  </>,
  // 14 Ix — ring and two points
  <>
    <circle cx="12" cy="13" r="7" />
    <Dot x={8} y={7} />
    <Dot x={16} y={7} />
  </>,
  // 15 Men — arc over a chevron
  <>
    <path d="M5 11 A7 7 0 0 1 19 11" />
    <polyline points="6,18 12,10 18,18" />
  </>,
  // 16 K'ib' — square holding a diamond
  <>
    <rect x="5" y="5" width="14" height="14" />
    <polygon points="12,6 18,12 12,18 6,12" />
  </>,
  // 17 Kaban — ring on a baseline
  <>
    <line x1="3" y1="17" x2="21" y2="17" />
    <circle cx="12" cy="10" r="6" />
  </>,
  // 18 Etz'nab' — crossed blades
  <>
    <line x1="5" y1="5" x2="19" y2="19" />
    <line x1="19" y1="5" x2="5" y2="19" />
  </>,
  // 19 Kawak — three dots over an arc
  <>
    <path d="M4 16 A8 6 0 0 0 20 16" />
    <Dot x={7} y={8} />
    <Dot x={12} y={6} />
    <Dot x={17} y={8} />
  </>,
  // 20 Ajaw — ring with cardinal ticks
  <>
    <circle cx="12" cy="12" r="7" />
    <line x1="12" y1="3" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="21" />
    <line x1="3" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="21" y2="12" />
  </>,
]

export function NawalGlyph({ nawal }: { nawal: number }) {
  const index = ((Math.trunc(nawal) - 1) % 20 + 20) % 20
  return (
    <g data-nawal={index + 1} strokeWidth={SW} fill="none" strokeLinecap="butt" strokeLinejoin="miter">
      {GLYPHS[index]}
    </g>
  )
}

export function NawalSheet() {
  return (
    <section data-nawal-sheet className="mt-8">
      <h2 className="text-[10px] tracking-[0.28em] text-white/40 uppercase">20 nawal · geometric</h2>
      <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-white/40">
        Original 24×24 marks for the 부적. Not Maya glyph copies and not Dreamspell icons.
      </p>
      <div className="mt-6 grid grid-cols-4 gap-5 md:grid-cols-5">
        {TZOLKIN_NAWAL.map((row, i) => (
          <figure key={row.name} className="flex flex-col items-center gap-2">
            <svg
              viewBox={`0 0 ${NAWAL_GLYPH_SIZE} ${NAWAL_GLYPH_SIZE}`}
              width={72}
              height={72}
              className="text-white"
              stroke="currentColor"
              fill="none"
              aria-label={`${i + 1} ${row.name}`}
            >
              <NawalGlyph nawal={i + 1} />
            </svg>
            <figcaption className="text-[11px] tracking-[0.08em] text-white/60">
              {i + 1} {row.name}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
