/**
 * Concentric 부적. Two weights:
 * major — core, 사주, 자미, 낙서, 주역, 점성 (large enough to deform)
 * minor — 수비, PRISM, 숙요, 촐킨, 타로, 룬 (rim engraving, no labels)
 * Value changes remove sectors, notch the rim, or fill a whole cell.
 */
import type { ReactNode } from 'react'
import { ELEMENT_META, type ElementKey, type FrameSpec, type PlanetMark, type TalismanSpec } from './variants'

const CX = 500
const CY = 500

const SW = { hair: 0.7, base: 1.15, emph: 2.2 } as const
const INK = {
  faint: 'rgba(255,255,255,0.16)',
  hair: 'rgba(255,255,255,0.34)',
  base: 'rgba(255,255,255,0.62)',
  strong: 'rgba(255,255,255,0.92)',
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

const ORIGIN = 26
const CELL = 316
const CORE = 154
const SAJU_R = 198
const TRIGRAM_R = 236
const SIGN_R = 278
const ZIWEI_IN = 314
const ZIWEI_OUT = 430

const SIGN_ABBR = ['AR', 'TA', 'GE', 'CN', 'LE', 'VI', 'LI', 'SC', 'SG', 'CP', 'AQ', 'PI'] as const
/** 육친 index → which trigram segment it vacates. */
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

function bandPath(r0: number, r1: number, a0: number, a1: number): string {
  const steps = 8
  const outer: string[] = []
  const inner: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = a0 + ((a1 - a0) * i) / steps
    const o = polar(r1, t)
    const inn = polar(r0, t)
    outer.push(`${o.x},${o.y}`)
    inner.push(`${inn.x},${inn.y}`)
  }
  return `M${outer.join(' L')} L${[...inner].reverse().join(' L')} Z`
}

function polyPoints(n: number, r: number, rotDeg: number): string {
  const pts: string[] = []
  for (let i = 0; i < n; i += 1) {
    const p = polar(r, rotDeg + (i * 360) / n)
    pts.push(`${p.x},${p.y}`)
  }
  return pts.join(' ')
}

function PhysicsGlyph({ element, accent }: { element: ElementKey; accent: string }) {
  const label = {
    fill: accent,
    stroke: 'none' as const,
    fontFamily: 'ui-monospace, monospace',
  }
  return (
    <g transform={`translate(${CX} ${CY - 36})`} stroke={accent} fill="none" strokeLinecap="butt">
      {element === 'water' ? (
        <g strokeWidth={2.2}>
          <path d="M-34 10 L0 34 L34 10" />
          <path d="M-22 0 L0 16 L22 0" />
          <circle cy="34" r="3.5" fill={accent} stroke="none" />
          <text x="18" y="-6" fontSize="22" letterSpacing="1" {...label}>
            G
          </text>
        </g>
      ) : null}
      {element === 'wood' ? (
        <g strokeWidth={2.2}>
          <line x1="0" y1="-32" x2="0" y2="28" />
          <line x1="-26" y1="-26" x2="26" y2="26" />
          <line x1="26" y1="-26" x2="-26" y2="26" />
          <text x="14" y="18" fontSize="15" letterSpacing="0.8" {...label}>
            ds²
          </text>
        </g>
      ) : null}
      {element === 'earth' ? (
        <g strokeWidth={2.2}>
          <line x1="0" y1="-30" x2="0" y2="4" />
          <line x1="0" y1="4" x2="-22" y2="30" />
          <line x1="0" y1="4" x2="22" y2="30" />
          <path d="M16 -8 H30 L24 2 H34" />
          <text x="-46" y="-8" fontSize="14" letterSpacing="1.4" {...label}>
            W Z
          </text>
        </g>
      ) : null}
      {element === 'metal' ? (
        <g strokeWidth={2}>
          <circle cx="0" cy="-16" r="7" />
          <circle cx="-16" cy="16" r="7" />
          <circle cx="16" cy="16" r="7" />
          <line x1="0" y1="-9" x2="-12" y2="10" />
          <line x1="0" y1="-9" x2="12" y2="10" />
          <line x1="-9" y1="16" x2="9" y2="16" />
          <text x="26" y="4" fontSize="13" letterSpacing="0.6" {...label}>
            SU(3)
          </text>
        </g>
      ) : null}
      {element === 'fire' ? (
        <g strokeWidth={2.2}>
          <polyline points="-36,6 -28,-2 -20,6 -12,-2 -4,6 4,-2 12,6 20,-2 28,6 36,-2" />
          <polyline points="0,-28 -8,-20 0,-12 -8,-4 0,4 -8,12 0,20 -8,28 0,36" />
          <text x="16" y="-14" fontSize="26" fontFamily="ui-serif, serif" stroke="none" fill={accent}>
            γ
          </text>
        </g>
      ) : null}
    </g>
  )
}

function Trigram({ bits, x, y }: { bits: readonly boolean[]; x: number; y: number }) {
  const w = 16
  return (
    <g transform={`translate(${x} ${y})`} stroke={GROUND} strokeWidth={1.8} strokeLinecap="butt">
      {bits.map((yang, i) => {
        const yy = (i - 1) * 5.2
        if (yang) return <line key={i} x1={-w / 2} y1={yy} x2={w / 2} y2={yy} />
        return (
          <g key={i}>
            <line x1={-w / 2} y1={yy} x2={-2.2} y2={yy} />
            <line x1={2.2} y1={yy} x2={w / 2} y2={yy} />
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

function Centre({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const meta = ELEMENT_META[spec.element]
  const drain = spec.mode === 'drain'
  const barsTop = CY + 16
  return (
    <g>
      {drain ? (
        <>
          <circle cx={CX} cy={CY} r={CORE} fill={GROUND} stroke={accent} strokeWidth={3.2} />
          <circle cx={CX} cy={CY} r={CORE - 10} fill="none" stroke={accent} strokeWidth={1.2} />
          {Array.from({ length: 16 }, (_, i) => {
            const a = i * 22.5
            const a0 = polar(CORE + 2, a)
            const a1 = polar(CORE + 46, a)
            return <line key={i} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.emph} />
          })}
        </>
      ) : (
        <>
          <circle cx={CX} cy={CY} r={CORE} fill={accent} fillOpacity={0.5} stroke={accent} strokeWidth={3} />
          {Array.from({ length: 10 }, (_, i) => {
            const a = -20 + i * 18
            const a0 = polar(CORE - 16, a)
            const a1 = polar(CORE - 4, a)
            return <line key={i} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.base} />
          })}
        </>
      )}
      <g fill={drain ? INK.strong : '#fff'}>
        {spec.ichingLines.map((yang, i) => {
          const y = barsTop + i * 16
          const x0 = CX - 62
          const x1 = CX + 62
          if (yang) return <rect key={i} x={x0} y={y} width={x1 - x0} height={7} />
          return (
            <g key={i}>
              <rect x={x0} y={y} width={50} height={7} />
              <rect x={x1 - 50} y={y} width={50} height={7} />
            </g>
          )
        })}
      </g>
      <PhysicsGlyph element={spec.element} accent={accent} />
      <text
        x={CX}
        y={CY - 108}
        textAnchor="middle"
        fill={accent}
        fontSize="40"
        fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
      >
        {meta.hanja}
      </text>
      <text
        x={CX}
        y={CY + 128}
        textAnchor="middle"
        fill={accent}
        fontSize="15"
        fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
        letterSpacing="3"
      >
        {meta.guardian}  {meta.numbers}
      </text>
    </g>
  )
}

function ElementSector({ element, accent }: { element: ElementKey; accent: string }) {
  const aim = ELEMENT_AIM[element]
  return <path d={bandPath(CORE + 2, ZIWEI_OUT, aim - 18, aim + 18)} fill={accent} opacity={0.2} />
}

function SectorRays({ element, accent }: { element: ElementKey; accent: string }) {
  const aim = ELEMENT_AIM[element]
  const inner = polar(CORE + 2, aim)
  const edge0 = polar(ZIWEI_OUT + 6, aim - 18)
  const edge1 = polar(ZIWEI_OUT + 6, aim + 18)
  return (
    <g>
      <line x1={inner.x} y1={inner.y} x2={edge0.x} y2={edge0.y} stroke={accent} strokeWidth={2.6} />
      <line x1={inner.x} y1={inner.y} x2={edge1.x} y2={edge1.y} stroke={accent} strokeWidth={2.6} />
    </g>
  )
}

function Spine({ accent, wealth }: { accent: string; wealth: boolean }) {
  const gap = CORE + 4
  return (
    <g fill={accent} stroke={accent} strokeLinecap="butt">
      <rect x={CX - 3.5} y={18} width={7} height={CY - gap - 18} />
      <rect x={CX - 3.5} y={CY + gap} width={7} height={980 - (CY + gap)} />
      <rect x={CX - 28} y={10} width={56} height={5} />
      <polygon points={`${CX - 18},30 ${CX},14 ${CX + 18},30`} fill="none" strokeWidth={SW.emph} />
      {wealth ? (
        <>
          <rect x={CX - 70} y={24} width={140} height={118} fill={GROUND} stroke="none" />
          <text
            x={CX}
            y={118}
            textAnchor="middle"
            fill={accent}
            stroke="none"
            fontSize="96"
            fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
          >
            財
          </text>
        </>
      ) : null}
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
  const pts = spec.sajuChars.map((_, i) => polar(SAJU_R, -67.5 + i * 45))
  return (
    <g>
      {spec.sajuChung.map(([a, b]) => (
        <path key={`c${a}-${b}`} d={bow(pts[a]!, pts[b]!)} fill="none" stroke={INK.base} strokeWidth={SW.base} />
      ))}
      {spec.sajuHap.map(([a, b]) => (
        <path key={`h${a}-${b}`} d={bow(pts[a]!, pts[b]!)} fill="none" stroke={accent} strokeWidth={SW.emph} />
      ))}
      {spec.sajuChars.map((ch, i) => {
        const p = pts[i]!
        return (
          <g key={`${ch.hanja}-${i}`}>
            {ch.isDayMaster ? (
              <rect x={p.x - 16} y={p.y - 16} width={32} height={32} fill={GROUND} stroke={accent} strokeWidth={SW.emph} />
            ) : (
              <circle cx={p.x} cy={p.y} r={15} fill={GROUND} stroke={INK.strong} strokeWidth={SW.base} />
            )}
            <text
              x={p.x}
              y={p.y + 6}
              textAnchor="middle"
              fill={ch.isDayMaster ? accent : INK.strong}
              fontSize="18"
              fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
            >
              {ch.hanja}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function IchingGaps({ emptySeats }: { emptySeats: readonly number[] }) {
  const vacant = new Set(
    emptySeats.map((i) => BOKJANG_TRI[i]).filter((n): n is number => n != null),
  )
  return (
    <g>
      {TRIGRAMS.map((tri, i) => {
        const a0 = -90 + i * 45
        if (vacant.has(i)) {
          return (
            <path
              key={`gap-${i}`}
              d={bandPath(TRIGRAM_R - 36, SIGN_R + 18, a0 - 4, a0 + 49)}
              fill={GROUND}
            />
          )
        }
        const mid = polar(TRIGRAM_R, a0 + 22.5)
        return (
          <g key={i}>
            <path d={bandPath(TRIGRAM_R - 20, TRIGRAM_R + 20, a0 + 2, a0 + 43)} fill={INK.strong} />
            <Trigram bits={tri.bits} x={mid.x} y={mid.y} />
          </g>
        )
      })}
    </g>
  )
}

function Luoshu({ sealed, accent }: { sealed: readonly number[]; accent: string }) {
  return (
    <g>
      {LUOSHU.map((palace, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = ORIGIN + col * CELL
        const y = ORIGIN + row * CELL
        const covered = sealed.includes(palace)
        if (palace === 5) {
          const frame = CORE + 18
          return (
            <rect
              key={palace}
              x={CX - frame}
              y={CY - frame}
              width={frame * 2}
              height={frame * 2}
              fill="none"
              stroke={covered ? accent : INK.faint}
              strokeWidth={covered ? 4 : SW.hair}
            />
          )
        }
        const dx = col === 0 ? x + 46 : col === 2 ? x + CELL - 46 : x + CELL / 2
        const dy = row === 0 ? y + 42 : row === 2 ? y + CELL - 32 : y + CELL / 2
        return (
          <g key={palace}>
            <rect
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              fill={covered ? accent : 'none'}
              fillOpacity={covered ? 0.38 : 0}
              stroke={covered ? accent : INK.faint}
              strokeWidth={covered ? 2.4 : SW.hair}
            />
            {covered ? (
              <>
                <line x1={x + 28} y1={y + 28} x2={x + CELL - 28} y2={y + CELL - 28} stroke={accent} strokeWidth={8} />
                <line x1={x + CELL - 28} y1={y + 28} x2={x + 28} y2={y + CELL - 28} stroke={GROUND} strokeWidth={3} />
              </>
            ) : (
              <text
                x={dx}
                y={dy}
                textAnchor="middle"
                fill={INK.strong}
                fontSize="28"
                fontFamily="ui-serif, serif"
              >
                {palace}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function PalaceVoids({ palaces }: { palaces: TalismanSpec['palaces'] }) {
  if (palaces == null) return null
  return (
    <g>
      {palaces.map((palace, i) => {
        if (!palace.empty) return null
        const a0 = -90 + i * 30
        const edgeL = polar(ZIWEI_IN, a0)
        const edgeR = polar(ZIWEI_IN, a0 + 30)
        const rimL = polar(520, a0)
        const rimR = polar(520, a0 + 30)
        return (
          <g key={`void-${palace.name}`}>
            <path d={bandPath(ZIWEI_IN - 6, 530, a0 - 0.4, a0 + 30.4)} fill={GROUND} />
            <line x1={edgeL.x} y1={edgeL.y} x2={rimL.x} y2={rimL.y} stroke={INK.strong} strokeWidth={1.6} />
            <line x1={edgeR.x} y1={edgeR.y} x2={rimR.x} y2={rimR.y} stroke={INK.strong} strokeWidth={1.6} />
          </g>
        )
      })}
    </g>
  )
}

function ZiweiRing({ palaces, accent }: { palaces: TalismanSpec['palaces']; accent: string }) {
  if (palaces == null) return null
  return (
    <g>
      {palaces.map((palace, i) => {
        const a0 = -90 + i * 30
        const a1 = a0 + 30
        const mid = polar((ZIWEI_IN + ZIWEI_OUT) / 2, a0 + 15)
        if (palace.empty) return null
        if (palace.sealed) {
          const c0 = polar(ZIWEI_IN - 4, a0 + 6)
          const c1 = polar(ZIWEI_OUT + 16, a1 - 6)
          return (
            <g key={palace.name}>
              <path d={bandPath(ZIWEI_IN - 8, ZIWEI_OUT + 26, a0 + 0.8, a1 - 0.8)} fill={accent} />
              <line x1={c0.x} y1={c0.y} x2={c1.x} y2={c1.y} stroke={GROUND} strokeWidth={7} />
            </g>
          )
        }
        return (
          <g key={palace.name}>
            <path d={bandPath(ZIWEI_IN, ZIWEI_OUT, a0 + 0.8, a1 - 0.8)} fill={INK.strong} opacity={0.78} />
            <text
              x={mid.x}
              y={mid.y + 5}
              textAnchor="middle"
              fill={GROUND}
              fontSize="16"
              fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
            >
              {palace.name}
            </text>
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
        const p1 = polar(ZIWEI_OUT + 28, a - 15)
        const p2 = polar(ZIWEI_IN - 28, a)
        const p3 = polar(ZIWEI_OUT + 28, a + 15)
        const seat = polar(ZIWEI_IN - 8, a)
        return (
          <g key={i}>
            <path d={`M${p1.x},${p1.y} L${p2.x},${p2.y} L${p3.x},${p3.y} Z`} fill={GROUND} stroke={INK.strong} strokeWidth={SW.emph} />
            <rect x={seat.x - 11} y={seat.y - 11} width={22} height={22} fill={INK.strong} transform={`rotate(45 ${seat.x} ${seat.y})`} />
          </g>
        )
      })}
    </g>
  )
}

function AstroRing({ planets, ascendant, accent }: { planets: readonly PlanetMark[]; ascendant: number | null; accent: string }) {
  return (
    <g>
      {SIGN_ABBR.map((label, i) => {
        const mid = i * 30 + 15
        const p = polar(SIGN_R, 180 - mid)
        return (
          <text
            key={label}
            x={p.x}
            y={p.y + 4}
            textAnchor="middle"
            fill={INK.strong}
            fontSize="13"
            fontFamily="ui-monospace, monospace"
            letterSpacing="1"
          >
            {label}
          </text>
        )
      })}
      {planets.map((planet) => {
        const p = polar(SIGN_R + 22, 180 - planet.longitude)
        return <PlanetGlyph key={planet.id} id={planet.id} x={p.x} y={p.y} />
      })}
      {ascendant != null ? (
        <line
          x1={polar(CORE + 8, 180 - ascendant).x}
          y1={polar(CORE + 8, 180 - ascendant).y}
          x2={polar(ZIWEI_OUT + 8, 180 - ascendant).x}
          y2={polar(ZIWEI_OUT + 8, 180 - ascendant).y}
          stroke={accent}
          strokeWidth={SW.emph}
        />
      ) : null}
    </g>
  )
}

function MinorRim({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const dent = spec.prismDentAxis
  const hex: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const r = i === dent ? 430 : 458
    const p = polar(r, -90 + i * 60)
    hex.push(`${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
  }
  return (
    <g opacity={0.28}>
      {spec.numerology.map((digit, i) => (
        <polygon
          key={digit + '-' + i}
          points={polyPoints(Math.max(3, Math.min(digit, 12)), 448 + i * 5, -80 + i * 9)}
          fill="none"
          stroke={INK.hair}
          strokeWidth={SW.hair}
        />
      ))}
      <path d={`${hex.join(' ')} Z`} fill="#6b5b8c" fillOpacity={0.12} stroke={INK.faint} strokeWidth={SW.hair} />
      <circle cx={CX} cy={CY} r={466} fill="none" stroke={INK.hair} strokeWidth={SW.hair} strokeDasharray="1.5 7" />
      {(() => {
        const a = 90 - spec.sukuyouIndex * 13
        const p0 = polar(462, a)
        const p1 = polar(474, a)
        return <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={INK.strong} strokeWidth={SW.base} />
      })()}
      <circle cx={CX} cy={CY} r={474} fill="none" stroke={INK.faint} strokeWidth={SW.hair} strokeDasharray="1 5" />
      {(
        [
          ['wands', -1, -1],
          ['cups', 1, -1],
          ['swords', -1, 1],
          ['pentacles', 1, 1],
        ] as const
      ).map(([mark, sx, sy]) => {
        const x = CX + sx * 455
        const y = CY + sy * 455
        return (
          <g key={mark} transform={`translate(${x} ${y})`} stroke={INK.hair} fill="none" strokeWidth={SW.hair} opacity={0.8}>
            {mark === 'wands' ? <polyline points="0,-7 0,7 M-3,-2 0,-7 3,-2" /> : null}
            {mark === 'cups' ? <polyline points="-4,-4 4,-4 4,1 0,6 -4,1 -4,-4" /> : null}
            {mark === 'swords' ? <line x1="0" y1="-7" x2="0" y2="7" /> : null}
            {mark === 'pentacles' ? <polygon points="0,-6 5,-2 3,5 -3,5 -5,-2" /> : null}
          </g>
        )
      })}
      {spec.bindrune ? (
        <g transform={`translate(${CX + 468} ${CY})`} stroke={accent} fill="none" strokeWidth={SW.base}>
          <line x1="0" y1="-12" x2="0" y2="12" />
          <polyline points="-6,-2 0,-9 6,-2" />
          <line x1="0" y1="-4" x2="8" y2="-10" />
          <line x1="0" y1="1" x2="-8" y2="8" />
        </g>
      ) : null}
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
  return <g opacity={0.28}>{lines}</g>
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
        <ElementSector element={spec.element} accent={accent} />
        <Luoshu sealed={spec.luoshuSealed} accent={accent} />
        <MinorRim spec={spec} accent={accent} />
        <AstroRing planets={spec.planets} ascendant={spec.ascendant} accent={accent} />
        <ZiweiRing palaces={spec.palaces} accent={accent} />
        <IchingGaps emptySeats={spec.bokjangEmpty} />
        <PalaceVoids palaces={spec.palaces} />
        <HyungNotches spec={spec} />
        <SajuRing spec={spec} accent={accent} />
        <Spine accent={accent} wealth={spec.purposeWealth} />
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
    </svg>
  )
}
