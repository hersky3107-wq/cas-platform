/**
 * Concentric 부적. Three zones:
 *   dense carved core / textured middle (all scripts) / sparse rim
 * Seals BIND with closed locks. Bindrune and Latin sit in the middle at readable size.
 */
import type { ReactNode } from 'react'
import { ELEMENT_META, type ElementKey, type FrameSpec, type PlanetMark, type TalismanSpec } from './variants'

const CX = 500
const CY = 500

const SW = { hair: 0.7, base: 1.2, emph: 2.4 } as const
const INK = {
  faint: 'rgba(255,255,255,0.14)',
  hair: 'rgba(255,255,255,0.3)',
  base: 'rgba(255,255,255,0.58)',
  strong: 'rgba(255,255,255,0.9)',
} as const
const GROUND = '#07080c'

/** 0° east, 90° north. Matches polar(). */
const ELEMENT_AIM: Record<ElementKey, number> = {
  wood: 0,
  fire: 270,
  earth: 225,
  metal: 180,
  water: 90,
}

const CORE = 148
const LATIN_R = 176
const SAJU_R = 196
const LUOSHU_HALF = 218
const TRIGRAM_R = 252
const SCRIPT_R = 278
const SIGN_R = 300
const ZIWEI_IN = 332
const ZIWEI_OUT = 396

const SIGN_ABBR = ['AR', 'TA', 'GE', 'CN', 'LE', 'VI', 'LI', 'SC', 'SG', 'CP', 'AQ', 'PI'] as const
const BOKJANG_TRI = [1, 3, 4, 6, 7]
const TRIGRAMS: readonly { bits: readonly boolean[] }[] = [
  { bits: [true, true, true] },
  { bits: [true, true, false] },
  { bits: [true, false, true] },
  { bits: [true, false, false] },
  { bits: [false, true, true] },
  { bits: [false, true, false] },
  { bits: [false, false, true] },
  { bits: [false, false, false] },
]
const LUOSHU = [4, 9, 2, 3, 5, 7, 8, 1, 6] as const
/** Classical caps, V for U. */
const LATIN = 'SIGILLVM STELLARVM · NON VNA TERRA ·'

type Pt = { x: number; y: number }

function round(n: number): number {
  return Math.round(n * 10) / 10
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function polar(r: number, degFromEastCc: number): Pt {
  const rad = degToRad(degFromEastCc)
  return { x: round(CX + r * Math.cos(rad)), y: round(CY - r * Math.sin(rad)) }
}

function polarJ(r: number, deg: number, k: number): Pt {
  const j = 1 + 0.022 * Math.sin(deg * 0.067 + k * 1.17)
  return polar(r * j, deg)
}

function bandPath(r0: number, r1: number, a0: number, a1: number, k = 0): string {
  const steps = 10
  const outer: string[] = []
  const inner: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = a0 + ((a1 - a0) * i) / steps
    const o = polarJ(r1, t, k)
    const inn = polarJ(r0, t, k + 1)
    outer.push(`${o.x},${o.y}`)
    inner.push(`${inn.x},${inn.y}`)
  }
  return `M${outer.join(' L')} L${[...inner].reverse().join(' L')} Z`
}

function arcPoly(r: number, a0: number, a1: number, k = 0, steps = 28): string {
  const pts: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = a0 + ((a1 - a0) * i) / steps
    const p = polarJ(r, t, k)
    pts.push(`${p.x},${p.y}`)
  }
  return pts.join(' ')
}

function polyPoints(n: number, r: number, rotDeg: number): string {
  const pts: string[] = []
  for (let i = 0; i < n; i += 1) {
    const p = polarJ(r, rotDeg + (i * 360) / n, i)
    pts.push(`${p.x},${p.y}`)
  }
  return pts.join(' ')
}

function Hanjatext({
  x,
  y,
  size,
  fill,
  children,
  dy = 0,
}: {
  x: number
  y: number
  size: number
  fill: string
  children: string
  dy?: number
}) {
  return (
    <text
      x={x}
      y={y + dy}
      textAnchor="middle"
      fill={fill}
      stroke={GROUND}
      strokeWidth={size * 0.08}
      paintOrder="stroke"
      fontSize={size}
      fontFamily="ui-serif, 'Noto Serif CJK KR', 'Source Han Serif KR', serif"
    >
      {children}
    </text>
  )
}

/** Closed lock — concentric rings and a wrapping cord. No strike-through. */
function Lock({ x, y, accent, scale = 1 }: { x: number; y: number; accent: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={accent} fill="none" strokeLinecap="butt">
      <circle r="36" strokeWidth={2.6} />
      <circle r="27" strokeWidth={1.3} />
      <circle r="16" strokeWidth={2} />
      <path d="M-20,-6 C-10,-26 10,-26 20,-6" strokeWidth={2.2} />
      <path d="M-20,6 C-10,26 10,26 20,6" strokeWidth={2.2} />
      <rect x="-10" y="-10" width="20" height="20" strokeWidth={1.7} transform="rotate(45)" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = i * 30
        const p0 = polar(32, a)
        const p1 = polar(36, a)
        return <line key={i} x1={p0.x - CX} y1={p0.y - CY} x2={p1.x - CX} y2={p1.y - CY} strokeWidth={1.2} />
      })}
    </g>
  )
}

/** Overlapped runes: Tiwaz + Algiz + Othala, bound by rings. */
function BindruneMark({ x, y, accent }: { x: number; y: number; accent: string }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={accent} fill="none" strokeLinecap="butt">
      <circle r="48" strokeWidth={2.2} />
      <circle r="56" strokeWidth={1.1} />
      <line x1="0" y1="-46" x2="0" y2="44" strokeWidth={3.2} />
      <polyline points="-20,-22 0,-46 20,-22" strokeWidth={2.8} />
      <polyline points="-24,6 0,-18 24,6" strokeWidth={2.6} />
      <polygon points="0,-6 -16,14 0,32 16,14" strokeWidth={2.4} />
      <line x1="-18" y1="22" x2="22" y2="-4" strokeWidth={2} />
      <line x1="-14" y1="36" x2="14" y2="36" strokeWidth={2} />
    </g>
  )
}

function PhysicsGlyph({ element, accent }: { element: ElementKey; accent: string }) {
  const label = { fill: accent, stroke: 'none' as const, fontFamily: 'ui-monospace, monospace' }
  return (
    <g transform={`translate(${CX} ${CY + 8})`} stroke={accent} fill="none" strokeLinecap="butt">
      {element === 'water' ? (
        <g strokeWidth={2.6}>
          <path d="M-40 8 L0 38 L40 8" />
          <path d="M-26 -4 L0 16 L26 -4" />
          <circle cy="38" r="4" fill={accent} stroke="none" />
          <text x="22" y="-10" fontSize="28" letterSpacing="1" {...label}>
            G
          </text>
        </g>
      ) : null}
      {element === 'wood' ? (
        <g strokeWidth={2.6}>
          <line x1="0" y1="-36" x2="0" y2="32" />
          <line x1="-30" y1="-30" x2="30" y2="30" />
          <line x1="30" y1="-30" x2="-30" y2="30" />
          <text x="16" y="22" fontSize="18" letterSpacing="0.8" {...label}>
            ds²
          </text>
        </g>
      ) : null}
      {element === 'earth' ? (
        <g strokeWidth={2.6}>
          <line x1="0" y1="-34" x2="0" y2="4" />
          <line x1="0" y1="4" x2="-26" y2="34" />
          <line x1="0" y1="4" x2="26" y2="34" />
          <path d="M18 -10 H36 L28 2 H40" />
          <text x="-52" y="-10" fontSize="18" letterSpacing="1.4" {...label}>
            W Z
          </text>
        </g>
      ) : null}
      {element === 'metal' ? (
        <g strokeWidth={2.4}>
          <circle cx="0" cy="-18" r="9" />
          <circle cx="-18" cy="18" r="9" />
          <circle cx="18" cy="18" r="9" />
          <line x1="0" y1="-9" x2="-13" y2="12" />
          <line x1="0" y1="-9" x2="13" y2="12" />
          <line x1="-10" y1="18" x2="10" y2="18" />
          <text x="28" y="6" fontSize="16" letterSpacing="0.6" {...label}>
            SU(3)
          </text>
        </g>
      ) : null}
      {element === 'fire' ? (
        <g strokeWidth={2.6}>
          <polyline points="-42,8 -32,-2 -22,8 -12,-2 -2,8 8,-2 18,8 28,-2 38,8" />
          <polyline points="0,-34 -10,-24 0,-14 -10,-4 0,6 -10,16 0,26 -10,36 0,44" />
          <text x="18" y="-16" fontSize="32" fontFamily="ui-serif, serif" stroke="none" fill={accent}>
            γ
          </text>
        </g>
      ) : null}
    </g>
  )
}

function GuardianMark({ element, accent }: { element: ElementKey; accent: string }) {
  const meta = ELEMENT_META[element]
  return (
    <g transform={`translate(${CX} ${CY + 108})`} stroke={accent} fill="none" strokeLinecap="butt">
      {element === 'fire' ? (
        <polyline points="-16,-6 -8,-14 0,-4 8,-14 16,-6 0,10 -16,-6" strokeWidth={1.6} />
      ) : null}
      {element === 'water' ? (
        <path d="M-14 4 C-14 -10 0 -16 0 -2 C0 -16 14 -10 14 4 C8 16 0 18 -14 4" strokeWidth={1.6} />
      ) : null}
      {element === 'wood' ? (
        <polyline points="0,12 0,-14 -10,-4 0,-14 10,-4" strokeWidth={1.6} />
      ) : null}
      {element === 'metal' ? (
        <polygon points="0,-12 10,0 0,12 -10,0" strokeWidth={1.6} />
      ) : null}
      {element === 'earth' ? (
        <path d="M-12 8 L0 -12 L12 8 Z M-8 8 H8" strokeWidth={1.6} />
      ) : null}
      <text
        x="0"
        y="28"
        textAnchor="middle"
        fill={accent}
        stroke="none"
        fontSize="16"
        fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
        letterSpacing="2.4"
      >
        {meta.guardian}  {meta.numbers}
      </text>
    </g>
  )
}

function Centre({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const meta = ELEMENT_META[spec.element]
  const drain = spec.mode === 'drain'
  const aim = ELEMENT_AIM[spec.element]
  const gap0 = (aim + 150) % 360
  const gap1 = gap0 + 38
  const rings = [36, 52, 68, 84, 100, 116, 132]
  return (
    <g>
      {drain ? null : <circle cx={CX} cy={CY} r={CORE} fill={accent} fillOpacity={0.18} stroke="none" />}
      {rings.map((r, i) => (
        <polyline
          key={r}
          points={arcPoly(r, gap1 + i * 4, gap0 + 352 - i * 3, i)}
          fill="none"
          stroke={accent}
          strokeWidth={i % 2 === 0 ? 1.1 : 0.7}
          opacity={0.85}
        />
      ))}
      <polyline points={arcPoly(CORE, gap1, gap0 + 360, 1)} fill="none" stroke={accent} strokeWidth={2.8} />
      {Array.from({ length: 24 }, (_, i) => {
        const a = aim - 90 + i * 7.5
        const a0 = polar(42, a)
        const a1 = polar(CORE - 8, a)
        return <line key={i} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={0.7} opacity={0.55} />
      })}
      <polygon points={polyPoints(8, 58, 22)} fill="none" stroke={accent} strokeWidth={1.1} />
      {drain
        ? Array.from({ length: 12 }, (_, i) => {
            const a = aim - 66 + i * 11
            const a0 = polar(CORE + 2, a)
            const a1 = polar(CORE + 42, a)
            return <line key={`d${i}`} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.emph} />
          })
        : null}
      <PhysicsGlyph element={spec.element} accent={accent} />
      <Hanjatext x={CX} y={CY - 78} size={58} fill={accent}>
        {meta.hanja}
      </Hanjatext>
      <GuardianMark element={spec.element} accent={accent} />
    </g>
  )
}

function LatinRing() {
  const chars = LATIN.split('')
  const step = 360 / chars.length
  return (
    <g>
      {chars.map((ch, i) => {
        const a = 90 - i * step
        const p = polar(LATIN_R, a)
        const rot = 90 - a
        return (
          <text
            key={`${ch}-${i}`}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={INK.strong}
            fontSize="26"
            fontFamily="ui-serif, Georgia, 'Times New Roman', serif"
            letterSpacing="1"
            transform={`rotate(${rot} ${p.x} ${p.y})`}
          >
            {ch}
          </text>
        )
      })}
    </g>
  )
}

function ElementSector({ element, accent }: { element: ElementKey; accent: string }) {
  const aim = ELEMENT_AIM[element]
  return <path d={bandPath(CORE + 2, ZIWEI_OUT + 8, aim - 16, aim + 16, 2)} fill={accent} opacity={0.14} />
}

function SectorRays({ element, accent }: { element: ElementKey; accent: string }) {
  const aim = ELEMENT_AIM[element]
  const inner = polar(CORE + 2, aim)
  const edge0 = polarJ(ZIWEI_OUT + 10, aim - 17, 4)
  const edge1 = polarJ(ZIWEI_OUT + 10, aim + 17, 5)
  return (
    <g>
      <line x1={inner.x} y1={inner.y} x2={edge0.x} y2={edge0.y} stroke={accent} strokeWidth={2.6} />
      <line x1={inner.x} y1={inner.y} x2={edge1.x} y2={edge1.y} stroke={accent} strokeWidth={2.6} />
    </g>
  )
}

function Spine({ accent, wealth, bindrune }: { accent: string; wealth: boolean; bindrune: boolean }) {
  const gap = CORE + 4
  const runeY = wealth ? CY - CORE - 118 : CY - CORE - 62
  return (
    <g fill={accent} stroke={accent} strokeLinecap="butt">
      <rect x={CX - 4} y={18} width={8} height={CY - gap - 18} />
      <rect x={CX - 4} y={CY + gap} width={8} height={980 - (CY + gap)} />
      <rect x={CX - 30} y={10} width={60} height={6} />
      <polygon points={`${CX - 18},30 ${CX},14 ${CX + 18},30`} fill="none" strokeWidth={SW.emph} />
      {wealth ? (
        <Hanjatext x={CX} y={92} size={72} fill={accent}>
          財
        </Hanjatext>
      ) : null}
      {bindrune ? <BindruneMark x={CX} y={runeY} accent={accent} /> : null}
      <polygon points={`${CX - 16},972 ${CX},992 ${CX + 16},972`} fill="none" strokeWidth={SW.emph} />
      <rect x={CX - 24} y={988} width={48} height={4} />
    </g>
  )
}

function bow(a: Pt, b: Pt): string {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  let px = -dy / len
  let py = dx / len
  const out = (mx + px * 80 - CX) * (mx - CX) + (my + py * 80 - CY) * (my - CY)
  if (out < 0) {
    px = -px
    py = -py
  }
  return `M${a.x},${a.y} Q${round(mx + px * 86)},${round(my + py * 86)} ${b.x},${b.y}`
}

function SajuRing({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const pts = spec.sajuChars.map((_, i) => polarJ(SAJU_R, -67.5 + i * 45, i))
  return (
    <g>
      {spec.sajuChung.map(([a, b]) => (
        <path key={`c${a}-${b}`} d={bow(pts[a]!, pts[b]!)} fill="none" stroke={INK.base} strokeWidth={SW.hair} />
      ))}
      {spec.sajuHap.map(([a, b]) => (
        <path key={`h${a}-${b}`} d={bow(pts[a]!, pts[b]!)} fill="none" stroke={accent} strokeWidth={SW.base} />
      ))}
      {pts.map((p, i) => (
        <line
          key={`ray-${i}`}
          x1={CX}
          y1={CY}
          x2={p.x}
          y2={p.y}
          stroke={INK.faint}
          strokeWidth={SW.hair}
        />
      ))}
      {spec.sajuChars.map((ch, i) => {
        const p = pts[i]!
        return (
          <g key={`${ch.hanja}-${i}`}>
            {ch.isDayMaster ? (
              <rect x={p.x - 20} y={p.y - 20} width={40} height={40} fill={GROUND} stroke={accent} strokeWidth={SW.emph} />
            ) : (
              <circle cx={p.x} cy={p.y} r={20} fill={GROUND} stroke={INK.hair} strokeWidth={SW.hair} />
            )}
            <Hanjatext x={p.x} y={p.y} size={32} fill={ch.isDayMaster ? accent : INK.strong} dy={11}>
              {ch.hanja}
            </Hanjatext>
          </g>
        )
      })}
    </g>
  )
}

function HexagramStack({ lines }: { lines: readonly boolean[] }) {
  const x = CX - 118
  const y0 = CY - 52
  return (
    <g stroke={INK.strong} strokeLinecap="butt">
      {lines.map((yang, i) => {
        const y = y0 + i * 14
        if (yang) return <line key={i} x1={x - 28} y1={y} x2={x + 28} y2={y} strokeWidth={3.4} />
        return (
          <g key={i}>
            <line x1={x - 28} y1={y} x2={x - 5} y2={y} strokeWidth={3.4} />
            <line x1={x + 5} y1={y} x2={x + 28} y2={y} strokeWidth={3.4} />
          </g>
        )
      })}
    </g>
  )
}

function IchingGaps({ emptySeats }: { emptySeats: readonly number[] }) {
  const vacant = new Set(emptySeats.map((i) => BOKJANG_TRI[i]).filter((n): n is number => n != null))
  return (
    <g>
      {TRIGRAMS.map((tri, i) => {
        const a0 = -90 + i * 45
        if (vacant.has(i)) {
          const left = polarJ(TRIGRAM_R - 18, a0 + 4, i)
          const right = polarJ(TRIGRAM_R - 18, a0 + 41, i)
          const leftO = polarJ(TRIGRAM_R + 18, a0 + 4, i)
          const rightO = polarJ(TRIGRAM_R + 18, a0 + 41, i)
          return (
            <g key={`gap-${i}`}>
              <line x1={left.x} y1={left.y} x2={leftO.x} y2={leftO.y} stroke={INK.hair} strokeWidth={SW.hair} />
              <line x1={right.x} y1={right.y} x2={rightO.x} y2={rightO.y} stroke={INK.hair} strokeWidth={SW.hair} />
            </g>
          )
        }
        const mid = polarJ(TRIGRAM_R, a0 + 22.5, i)
        const w = 16
        return (
          <g key={i} transform={`translate(${mid.x} ${mid.y})`} stroke={INK.base} strokeWidth={1.5} strokeLinecap="butt">
            {tri.bits.map((yang, b) => {
              const yy = (b - 1) * 5.4
              if (yang) return <line key={b} x1={-w / 2} y1={yy} x2={w / 2} y2={yy} />
              return (
                <g key={b}>
                  <line x1={-w / 2} y1={yy} x2={-2.2} y2={yy} />
                  <line x1={2.2} y1={yy} x2={w / 2} y2={yy} />
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

function Luoshu({ sealed, accent }: { sealed: readonly number[]; accent: string }) {
  const half = LUOSHU_HALF
  const cell = round((half * 2) / 3)
  const originX = round(CX - half)
  const originY = round(CY - half)
  return (
    <g>
      <rect x={originX} y={originY} width={half * 2} height={half * 2} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
      {LUOSHU.map((palace, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = originX + col * cell
        const y = originY + row * cell
        const cx = x + cell / 2
        const cy = y + cell / 2
        const covered = sealed.includes(palace)
        if (palace === 5) {
          if (!covered) return null
          return (
            <g key={palace}>
              <circle cx={CX} cy={CY} r={CORE + 5} fill="none" stroke={accent} strokeWidth={2.4} />
              <circle cx={CX} cy={CY} r={CORE + 13} fill="none" stroke={accent} strokeWidth={1.2} />
              <path
                d={`M${CX - 42} ${CY - CORE + 8} C${CX - 18} ${CY - CORE - 18} ${CX + 18} ${CY - CORE - 18} ${CX + 42} ${CY - CORE + 8}`}
                fill="none"
                stroke={accent}
                strokeWidth={2}
              />
            </g>
          )
        }
        return (
          <g key={palace}>
            <rect x={x} y={y} width={cell} height={cell} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
            <text
              x={cx}
              y={cy + 7}
              textAnchor="middle"
              fill={INK.hair}
              fontSize="16"
              fontFamily="ui-serif, serif"
              opacity={covered ? 0.45 : 1}
            >
              {palace}
            </text>
            {covered ? <Lock x={cx} y={cy} accent={accent} scale={0.92} /> : null}
          </g>
        )
      })}
    </g>
  )
}

function TarotMark({ mark, x, y }: { mark: 'wands' | 'cups' | 'swords' | 'pentacles'; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={INK.strong} fill="none" strokeWidth={1.8} strokeLinecap="butt">
      {mark === 'wands' ? (
        <>
          <line x1="0" y1="-22" x2="0" y2="22" />
          <polyline points="-10,-8 0,-22 10,-8" />
          <line x1="-7" y1="6" x2="7" y2="6" />
        </>
      ) : null}
      {mark === 'cups' ? <path d="M-12,-16 H12 V-2 C12 12 0 20 0 20 C0 20 -12 12 -12 -2 Z" /> : null}
      {mark === 'swords' ? (
        <>
          <line x1="0" y1="-24" x2="0" y2="20" />
          <polygon points="0,-24 -6,-12 6,-12" />
          <line x1="-10" y1="4" x2="10" y2="4" />
        </>
      ) : null}
      {mark === 'pentacles' ? (
        <>
          <circle r="16" />
          <polygon points="0,-14 8,-4 5,12 -5,12 -8,-4" />
        </>
      ) : null}
    </g>
  )
}

function MayaKin({ tone, nawal, x, y }: { tone: number; nawal: number; x: number; y: number }) {
  const bars = Math.floor(tone / 5)
  const dots = tone % 5
  return (
    <g transform={`translate(${x} ${y})`} stroke={INK.strong} fill="none" strokeLinecap="butt">
      <rect x="-28" y="-34" width="56" height="68" rx="4" strokeWidth={1.6} />
      {Array.from({ length: bars }, (_, i) => (
        <rect key={`b${i}`} x="-16" y={-26 + i * 9} width="32" height="6" fill={INK.strong} stroke="none" />
      ))}
      {Array.from({ length: dots }, (_, i) => (
        <circle key={`d${i}`} cx={-12 + i * 8} cy={-26 + bars * 9 + 8} r="3.2" fill={INK.strong} stroke="none" />
      ))}
      <path
        d="M-14 10 L-4 2 L6 10 L14 4 L8 22 L-8 22 Z"
        strokeWidth={1.6}
        transform={`translate(0 ${bars > 0 ? 4 : 0})`}
      />
      <text
        x="0"
        y="38"
        textAnchor="middle"
        fill={INK.base}
        stroke="none"
        fontSize="11"
        fontFamily="ui-monospace, monospace"
      >
        {tone} · {nawal}
      </text>
    </g>
  )
}

function MiddleScripts({ spec }: { spec: TalismanSpec }) {
  const suits = [
    { mark: 'wands' as const, a: 128 },
    { mark: 'cups' as const, a: 52 },
    { mark: 'swords' as const, a: -128 },
    { mark: 'pentacles' as const, a: -52 },
  ]
  const kin = polar(SCRIPT_R, 200)
  return (
    <g>
      {spec.numerology.map((digit, i) => {
        const r = 228 + i * 8
        const rot = -78 + i * 11
        const label = polar(r, rot)
        return (
          <g key={`${digit}-${i}`}>
            <polygon
              points={polyPoints(Math.max(3, Math.min(digit, 12)), r, rot)}
              fill="none"
              stroke={INK.hair}
              strokeWidth={SW.hair}
            />
            <text
              x={label.x}
              y={label.y + 5}
              textAnchor="middle"
              fill={INK.base}
              fontSize="14"
              fontFamily="ui-monospace, monospace"
            >
              {digit}
            </text>
          </g>
        )
      })}
      {suits.map((s) => {
        const p = polar(SCRIPT_R, s.a)
        return <TarotMark key={s.mark} mark={s.mark} x={p.x} y={p.y} />
      })}
      <MayaKin tone={spec.tzolkinTone} nawal={spec.tzolkinNawal} x={kin.x} y={kin.y} />
    </g>
  )
}

function VacantCrown() {
  const inner = ZIWEI_IN + 4
  const outer = ZIWEI_OUT - 6
  return (
    <g>
      <polyline points={arcPoly(inner, 14, 172, 6)} fill="none" stroke={INK.hair} strokeWidth={SW.base} />
      <polyline points={arcPoly(inner, 196, 348, 6)} fill="none" stroke={INK.hair} strokeWidth={SW.base} />
      <polyline points={arcPoly(outer, -8, 154, 7)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
      <polyline points={arcPoly(outer, 178, 332, 7)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = -90 + i * 30
        const wob = 7 * Math.sin(i * 1.31 + 0.4)
        const p0 = polar(inner - 2, a)
        const p1 = polar(outer + 6 + wob, a)
        return <line key={i} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={INK.hair} strokeWidth={SW.hair} />
      })}
      {Array.from({ length: 12 }, (_, i) => {
        const a = -90 + i * 30 + 15
        const p = polar((inner + outer) / 2, a)
        return <circle key={`seat-${i}`} cx={p.x} cy={p.y} r={2.2} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
      })}
    </g>
  )
}

function ZiweiRing({ palaces, accent }: { palaces: TalismanSpec['palaces']; accent: string }) {
  if (palaces == null) return <VacantCrown />
  return (
    <g>
      {palaces.map((palace, i) => {
        const a0 = -90 + i * 30
        const a1 = a0 + 30
        const bulge = 10 * Math.sin(i * 1.7 + 0.5)
        const rOut = ZIWEI_OUT + bulge
        const mid = polarJ((ZIWEI_IN + rOut) / 2, a0 + 15, i)
        if (palace.empty) {
          const edgeL = polar(ZIWEI_IN, a0 + 3)
          const edgeR = polar(ZIWEI_IN, a1 - 3)
          const rimL = polar(rOut + 8, a0 + 3)
          const rimR = polar(rOut + 8, a1 - 3)
          return (
            <g key={palace.name} opacity={0.45}>
              <line x1={edgeL.x} y1={edgeL.y} x2={rimL.x} y2={rimL.y} stroke={INK.hair} strokeWidth={SW.hair} />
              <line x1={edgeR.x} y1={edgeR.y} x2={rimR.x} y2={rimR.y} stroke={INK.hair} strokeWidth={SW.hair} />
            </g>
          )
        }
        if (palace.sealed) {
          return (
            <g key={palace.name}>
              <polyline
                points={arcPoly(rOut + 4, a0 + 2, a1 - 2, i)}
                fill="none"
                stroke={accent}
                strokeWidth={SW.base}
              />
              <polyline
                points={arcPoly(ZIWEI_IN, a0 + 2, a1 - 2, i)}
                fill="none"
                stroke={accent}
                strokeWidth={SW.hair}
              />
              <Lock x={mid.x} y={mid.y} accent={accent} scale={0.55} />
            </g>
          )
        }
        return (
          <g key={palace.name}>
            <path d={bandPath(ZIWEI_IN, rOut, a0 + 1.2, a1 - 1.2, i)} fill={INK.strong} opacity={0.1} />
            <polyline
              points={arcPoly(rOut, a0 + 1.2, a1 - 1.2, i)}
              fill="none"
              stroke={INK.hair}
              strokeWidth={SW.base}
            />
            <Hanjatext x={mid.x} y={mid.y} size={26} fill={INK.strong} dy={9}>
              {palace.name}
            </Hanjatext>
          </g>
        )
      })}
    </g>
  )
}

function HyungNotches({ spec }: { spec: TalismanSpec }) {
  return (
    <g>
      {spec.nameSeals.map((seal, i) => {
        if (seal !== 'hyung') return null
        const a = -90 + i * 72
        const p1 = polarJ(ZIWEI_OUT + 6, a - 9, i)
        const p2 = polarJ(ZIWEI_IN + 24, a, i)
        const p3 = polarJ(ZIWEI_OUT + 6, a + 9, i)
        const seat = polar((ZIWEI_IN + ZIWEI_OUT) / 2, a)
        return (
          <g key={i}>
            <path
              d={`M${p1.x},${p1.y} L${p2.x},${p2.y} L${p3.x},${p3.y} Z`}
              fill={GROUND}
              stroke={INK.hair}
              strokeWidth={SW.hair}
            />
            <Lock x={seat.x} y={seat.y} accent={INK.strong} scale={0.58} />
          </g>
        )
      })}
    </g>
  )
}

function PlanetGlyph({ id, x, y }: { id: string; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(1.7)`} stroke={INK.base} fill="none" strokeWidth={1.1} strokeLinecap="butt">
      {id === 'sun' ? (
        <>
          <circle r="3.2" />
          <line x1="0" y1="-5.4" x2="0" y2="-4" />
          <line x1="0" y1="4" x2="0" y2="5.4" />
          <line x1="-5.4" y1="0" x2="-4" y2="0" />
          <line x1="4" y1="0" x2="5.4" y2="0" />
        </>
      ) : null}
      {id === 'moon' ? <path d="M2.2,-3.2 A3.2,3.2 0 1 0 2.2,3.2 A2.4,2.4 0 1 1 2.2,-3.2" /> : null}
      {id === 'mercury' ? (
        <>
          <circle cy="-1" r="2.2" />
          <line x1="0" y1="1.2" x2="0" y2="4.4" />
          <line x1="-2" y1="3" x2="2" y2="3" />
          <polyline points="-2,-2.6 0,-4.6 2,-2.6" />
        </>
      ) : null}
      {id === 'venus' ? (
        <>
          <circle cy="-1.2" r="2.3" />
          <line x1="0" y1="1.1" x2="0" y2="4.6" />
          <line x1="-1.8" y1="3" x2="1.8" y2="3" />
        </>
      ) : null}
      {id === 'mars' ? (
        <>
          <circle r="2.3" />
          <line x1="1.6" y1="-1.6" x2="4.2" y2="-4.2" />
          <polyline points="2.2,-4.2 4.2,-4.2 4.2,-2.2" />
        </>
      ) : null}
      {id === 'jupiter' ? (
        <>
          <line x1="-3" y1="-2.4" x2="3" y2="-2.4" />
          <line x1="-0.4" y1="-4" x2="-0.4" y2="4" />
          <polyline points="-2.6,1.2 0,4 3,0.6" />
        </>
      ) : null}
      {id === 'saturn' ? (
        <>
          <line x1="-1.4" y1="-4" x2="-1.4" y2="4" />
          <line x1="-3.2" y1="-1.6" x2="1.6" y2="-1.6" />
          <line x1="-1.4" y1="1.4" x2="3.2" y2="1.4" />
          <line x1="3.2" y1="0" x2="3.2" y2="3" />
        </>
      ) : null}
    </g>
  )
}

function AstroRing({
  planets,
  ascendant,
  accent,
}: {
  planets: readonly PlanetMark[]
  ascendant: number | null
  accent: string
}) {
  const pts = planets.map((planet) => ({ ...planet, p: polarJ(SIGN_R - 8, 180 - planet.longitude, 2) }))
  return (
    <g>
      {pts.map((a, i) =>
        pts.slice(i + 1).map((b) => (
          <line
            key={`${a.id}-${b.id}`}
            x1={a.p.x}
            y1={a.p.y}
            x2={b.p.x}
            y2={b.p.y}
            stroke={INK.faint}
            strokeWidth={SW.hair}
          />
        )),
      )}
      {SIGN_ABBR.map((label, i) => {
        const mid = i * 30 + 15
        const p = polarJ(SIGN_R, 180 - mid, i)
        return (
          <text
            key={label}
            x={p.x}
            y={p.y + 5}
            textAnchor="middle"
            fill={INK.base}
            fontSize="14"
            fontFamily="ui-serif, Georgia, serif"
            letterSpacing="1"
          >
            {label}
          </text>
        )
      })}
      {pts.map((planet) => (
        <PlanetGlyph key={planet.id} id={planet.id} x={planet.p.x} y={planet.p.y} />
      ))}
      {ascendant != null ? (
        <line
          x1={polar(CORE + 8, 180 - ascendant).x}
          y1={polar(CORE + 8, 180 - ascendant).y}
          x2={polarJ(ZIWEI_OUT + 6, 180 - ascendant, 3).x}
          y2={polarJ(ZIWEI_OUT + 6, 180 - ascendant, 3).y}
          stroke={accent}
          strokeWidth={SW.emph}
        />
      ) : (
        Array.from({ length: 12 }, (_, i) => {
          const a = 180 - i * 30
          const p0 = polar(SIGN_R - 16, a)
          const p1 = polar(SIGN_R - 6, a)
          return <line key={`h${i}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={INK.faint} strokeWidth={SW.hair} />
        })
      )}
    </g>
  )
}

function MinorRim({ spec }: { spec: TalismanSpec }) {
  const dent = spec.prismDentAxis
  const hex: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const r = i === dent ? 418 : 448 + (i % 2 === 0 ? 6 : -4)
    const p = polarJ(r, -90 + i * 60, i)
    hex.push(`${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
  }
  return (
    <g opacity={0.28}>
      <path d={`${hex.join(' ')} Z`} fill="#6b5b8c" fillOpacity={0.1} stroke={INK.faint} strokeWidth={SW.hair} />
      <polyline points={arcPoly(458, 12, 198, 8)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
      <polyline points={arcPoly(458, 224, 352, 8)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
      {(() => {
        const a = 90 - spec.sukuyouIndex * 13
        const p0 = polar(454, a)
        const p1 = polar(468, a)
        return <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={INK.strong} strokeWidth={SW.base} />
      })()}
      <polyline points={arcPoly(470, -20, 140, 9)} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
      <polyline points={arcPoly(470, 168, 310, 9)} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
    </g>
  )
}

function BleedGrid(): ReactNode {
  const lines: ReactNode[] = []
  for (let v = -200; v <= 1200; v += 50) {
    lines.push(
      <line key={`v${v}`} x1={v} y1={-200} x2={v} y2={1200} stroke={INK.faint} strokeWidth={SW.hair} />,
      <line key={`h${v}`} x1={-200} y1={v} x2={1200} y2={v} stroke={INK.faint} strokeWidth={SW.hair} />,
    )
  }
  return <g opacity={0.2}>{lines}</g>
}

function leanTransform(element: ElementKey, drain: boolean): string {
  const aim = ELEMENT_AIM[element]
  const lean = drain ? -5.4 : 5.2
  const pull = drain ? 12 : 18
  const ox = Math.cos(degToRad(aim)) * pull
  const oy = -Math.sin(degToRad(aim)) * pull
  return `translate(${round(ox)} ${round(oy)}) rotate(${lean} ${CX} ${CY})`
}

export function TalismanSvg({
  spec,
  frame,
  uid,
}: {
  spec: TalismanSpec
  frame: FrameSpec
  uid: string
}) {
  const accent = ELEMENT_META[spec.element].accent
  const [vx, vy, vw, vh] = frame.viewBox
  return (
    <svg
      className="talisman-svg"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      role="img"
      aria-label={`${spec.title} ${frame.label}`}
      style={{ width: '100%', height: '100%', display: 'block', background: GROUND }}
    >
      <defs>
        <clipPath id={`${uid}-frame`}>
          <rect x={vx} y={vy} width={vw} height={vh} />
        </clipPath>
      </defs>
      <rect x={vx} y={vy} width={vw} height={vh} fill={GROUND} />
      <g clipPath={`url(#${uid}-frame)`}>
        <BleedGrid />
        <g transform={leanTransform(spec.element, spec.mode === 'drain')}>
          <ElementSector element={spec.element} accent={accent} />
          <Luoshu sealed={spec.luoshuSealed} accent={accent} />
          <MinorRim spec={spec} />
          <AstroRing planets={spec.planets} ascendant={spec.ascendant} accent={accent} />
          <MiddleScripts spec={spec} />
          <IchingGaps emptySeats={spec.bokjangEmpty} />
          <HexagramStack lines={spec.ichingLines} />
          <LatinRing />
          <ZiweiRing palaces={spec.palaces} accent={accent} />
          <HyungNotches spec={spec} />
          <SajuRing spec={spec} accent={accent} />
          <Spine accent={accent} wealth={spec.purposeWealth} bindrune={spec.bindrune} />
          <Centre spec={spec} accent={accent} />
          <SectorRays element={spec.element} accent={accent} />
          <text
            x={CX}
            y={964}
            textAnchor="middle"
            fill={INK.hair}
            fontSize="11"
            fontFamily="ui-monospace, monospace"
            letterSpacing="2.4"
          >
            {spec.dateLabel} · {spec.sessionId}
          </text>
        </g>
      </g>
    </svg>
  )
}
