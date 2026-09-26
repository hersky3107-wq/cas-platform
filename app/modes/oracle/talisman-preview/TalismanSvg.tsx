/**
 * Concentric 부적 composition. Hard-coded geometry; no engine calls.
 * Stroke weights: hairline / base / emphasis. Linecap butt — not brushed.
 */
import type { ReactNode } from 'react'
import {
  ELEMENT_META,
  type ElementKey,
  type FrameSpec,
  type NameSeal,
  type PlanetMark,
  type TalismanSpec,
} from './variants'

const CX = 500
const CY = 500

const SW = { hair: 0.7, base: 1.15, emph: 1.8 } as const
const INK = {
  faint: 'rgba(255,255,255,0.14)',
  hair: 'rgba(255,255,255,0.32)',
  base: 'rgba(255,255,255,0.52)',
  strong: 'rgba(255,255,255,0.82)',
} as const

const R = {
  core: 46,
  name: 56,
  numIn: 64,
  numOut: 82,
  prism: 98,
  luoshu: 132,
  iching: 172,
  saju: 202,
  house: 224,
  astro: 248,
  ziwei: 286,
  sukuyou: 324,
  tzA: 344,
  tzB: 362,
  border: 384,
} as const

const SIGN_ABBR = ['AR', 'TA', 'GE', 'CN', 'LE', 'VI', 'LI', 'SC', 'SG', 'CP', 'AQ', 'PI'] as const
const HOUSE_NUM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'] as const
const RELATIVES = ['兄', '孫', '財', '官', '父'] as const
const TRIGRAMS: readonly { bits: readonly boolean[]; label: string }[] = [
  { bits: [true, true, true], label: '乾' },
  { bits: [true, true, false], label: '兌' },
  { bits: [true, false, true], label: '離' },
  { bits: [true, false, false], label: '震' },
  { bits: [false, true, true], label: '巽' },
  { bits: [false, true, false], label: '坎' },
  { bits: [false, false, true], label: '艮' },
  { bits: [false, false, false], label: '坤' },
]

type Pt = { x: number; y: number }

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Tropical longitude → SVG point. 0° Aries at 9 o'clock, counterclockwise. */
function zodiacPoint(r: number, longitude: number): Pt {
  const rad = degToRad(180 - longitude)
  return { x: round(CX + r * Math.cos(rad)), y: round(CY - r * Math.sin(rad)) }
}

function polar(r: number, degFromEastCc: number): Pt {
  const rad = degToRad(degFromEastCc)
  return { x: round(CX + r * Math.cos(rad)), y: round(CY - r * Math.sin(rad)) }
}

function polyPoints(n: number, r: number, rotDeg: number): string {
  const pts: string[] = []
  for (let i = 0; i < n; i += 1) {
    const p = polar(r, rotDeg + (i * 360) / n)
    pts.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`)
  }
  return pts.join(' ')
}

function hairCircle(r: number, opacity = 1): ReactNode {
  return (
    <circle
      cx={CX}
      cy={CY}
      r={r}
      fill="none"
      stroke={INK.hair}
      strokeWidth={SW.hair}
      opacity={opacity}
    />
  )
}

function PhysicsGlyph({ element, accent, drain }: { element: ElementKey; accent: string; drain: boolean }) {
  const s = drain ? 0.92 : 1
  return (
    <g transform={`translate(${CX} ${CY}) scale(${s})`} stroke={accent} fill="none" strokeLinecap="butt">
      {element === 'water' ? (
        <g strokeWidth={SW.base}>
          <path d="M-14 6 L0 16 L14 6" />
          <path d="M-10 2 L0 10 L10 2" />
          <circle cx="0" cy="16" r="2.2" fill={accent} stroke="none" />
          <text x="11" y="-8" fill={accent} stroke="none" fontSize="7" letterSpacing="1.4" fontFamily="ui-monospace, monospace">
            G
          </text>
        </g>
      ) : null}
      {element === 'wood' ? (
        <g strokeWidth={SW.base}>
          <line x1="0" y1="-16" x2="0" y2="16" />
          <line x1="-14" y1="-14" x2="14" y2="14" />
          <line x1="14" y1="-14" x2="-14" y2="14" />
          <text x="-17" y="20" fill={accent} stroke="none" fontSize="5.5" letterSpacing="1.2" fontFamily="ui-monospace, monospace">
            ds²
          </text>
        </g>
      ) : null}
      {element === 'earth' ? (
        <g strokeWidth={SW.base}>
          <line x1="0" y1="-16" x2="0" y2="0" />
          <line x1="0" y1="0" x2="-12" y2="14" />
          <line x1="0" y1="0" x2="12" y2="14" />
          <path d="M8 4 H16 L12 10 H18" />
          <text x="-18" y="-8" fill={accent} stroke="none" fontSize="6" letterSpacing="1.6" fontFamily="ui-monospace, monospace">
            W Z
          </text>
        </g>
      ) : null}
      {element === 'metal' ? (
        <g strokeWidth={SW.base}>
          <circle cx="0" cy="-10" r="3.2" />
          <circle cx="-9" cy="8" r="3.2" />
          <circle cx="9" cy="8" r="3.2" />
          <line x1="0" y1="-6.8" x2="-6.4" y2="5.4" />
          <line x1="0" y1="-6.8" x2="6.4" y2="5.4" />
          <line x1="-5.8" y1="8" x2="5.8" y2="8" />
          <text x="-16" y="20" fill={accent} stroke="none" fontSize="5.2" letterSpacing="0.8" fontFamily="ui-monospace, monospace">
            SU(3)
          </text>
        </g>
      ) : null}
      {element === 'fire' ? (
        <g strokeWidth={SW.base}>
          <polyline points="-16,0 -12,-4 -8,0 -4,-4 0,0 4,-4 8,0 12,-4 16,0" />
          <polyline points="0,-16 -4,-12 0,-8 -4,-4 0,0 -4,4 0,8 -4,12 0,16" />
          <text x="8" y="-10" fill={accent} stroke="none" fontSize="8" letterSpacing="1.2" fontFamily="ui-serif, serif">
            γ
          </text>
        </g>
      ) : null}
    </g>
  )
}

function Bindrune({ x, y, accent }: { x: number; y: number; accent: string }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={accent} fill="none" strokeWidth={SW.base} strokeLinecap="butt">
      <line x1="0" y1="-11" x2="0" y2="11" />
      <polyline points="-6,-2 0,-8 6,-2" />
      <line x1="0" y1="-4" x2="7" y2="-9" />
      <line x1="0" y1="0" x2="7" y2="-5" />
      <line x1="0" y1="-1" x2="-7" y2="6" />
    </g>
  )
}

function PlanetGlyph({ id, x, y, accent }: { id: string; x: number; y: number; accent: string }) {
  const common = { stroke: accent, fill: 'none' as const, strokeWidth: SW.hair, strokeLinecap: 'butt' as const }
  return (
    <g transform={`translate(${x} ${y})`} {...common}>
      {id === 'sun' ? (
        <>
          <circle r="2.4" />
          <line x1="0" y1="-4.4" x2="0" y2="-3.2" />
          <line x1="0" y1="3.2" x2="0" y2="4.4" />
          <line x1="-4.4" y1="0" x2="-3.2" y2="0" />
          <line x1="3.2" y1="0" x2="4.4" y2="0" />
        </>
      ) : null}
      {id === 'moon' ? (
        <>
          <circle r="2.6" />
          <circle cx="1.2" r="2.6" stroke={INK.faint} />
        </>
      ) : null}
      {id === 'mercury' ? (
        <>
          <circle cy="-1.2" r="1.8" />
          <line x1="0" y1="0.6" x2="0" y2="3.6" />
          <line x1="-1.6" y1="2.4" x2="1.6" y2="2.4" />
          <polyline points="-1.8,-2.4 0,-4.2 1.8,-2.4" />
        </>
      ) : null}
      {id === 'venus' ? (
        <>
          <circle cy="-1.4" r="1.9" />
          <line x1="0" y1="0.5" x2="0" y2="3.8" />
          <line x1="-1.5" y1="2.4" x2="1.5" y2="2.4" />
        </>
      ) : null}
      {id === 'mars' ? (
        <>
          <circle r="1.9" />
          <line x1="1.4" y1="-1.4" x2="3.4" y2="-3.4" />
          <polyline points="1.8,-3.4 3.4,-3.4 3.4,-1.8" />
        </>
      ) : null}
      {id === 'jupiter' ? (
        <>
          <line x1="-2.4" y1="-2" x2="2.4" y2="-2" />
          <line x1="-0.4" y1="-3.4" x2="-0.4" y2="3.2" />
          <polyline points="-2.2,1.0 0,3.2 2.4,0.6" />
        </>
      ) : null}
      {id === 'saturn' ? (
        <>
          <line x1="-1.2" y1="-3.2" x2="-1.2" y2="3.2" />
          <line x1="-2.6" y1="-1.4" x2="1.2" y2="-1.4" />
          <line x1="-1.2" y1="1.2" x2="2.6" y2="1.2" />
          <line x1="2.6" y1="0" x2="2.6" y2="2.4" />
        </>
      ) : null}
    </g>
  )
}

function Trigram({ bits, x, y, scale }: { bits: readonly boolean[]; x: number; y: number; scale: number }) {
  const w = 10 * scale
  const gap = 1.6 * scale
  return (
    <g transform={`translate(${x} ${y})`} stroke={INK.base} strokeWidth={SW.hair} strokeLinecap="butt">
      {bits.map((yang, i) => {
        const yy = (i - 1) * 3.4 * scale
        if (yang) return <line key={i} x1={-w / 2} y1={yy} x2={w / 2} y2={yy} />
        return (
          <g key={i}>
            <line x1={-w / 2} y1={yy} x2={-gap} y2={yy} />
            <line x1={gap} y1={yy} x2={w / 2} y2={yy} />
          </g>
        )
      })}
    </g>
  )
}

function Centre({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const meta = ELEMENT_META[spec.element]
  const drain = spec.mode === 'drain'
  return (
    <g>
      {drain ? (
        <>
          <circle cx={CX} cy={CY} r={R.core} fill="none" stroke={accent} strokeWidth={SW.emph} />
          <circle cx={CX} cy={CY} r={R.core - 7} fill="none" stroke={accent} strokeWidth={SW.hair} opacity={0.7} />
          {Array.from({ length: 12 }, (_, i) => {
            const a = i * 30
            const a0 = polar(R.core + 1, a)
            const a1 = polar(R.core + 6, a)
            return <line key={i} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.hair} />
          })}
        </>
      ) : (
        <>
          <circle cx={CX} cy={CY} r={R.core} fill={accent} fillOpacity={0.14} stroke={accent} strokeWidth={SW.emph} />
          {Array.from({ length: 8 }, (_, i) => {
            const a = i * 45 + 22.5
            const a0 = polar(R.core - 8, a)
            const a1 = polar(R.core - 2, a)
            return <line key={i} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.hair} />
          })}
        </>
      )}
      <PhysicsGlyph element={spec.element} accent={accent} drain={drain} />
      <text
        x={CX}
        y={CY - 28}
        textAnchor="middle"
        fill={accent}
        fontSize="13"
        fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
        letterSpacing="2.4"
      >
        {meta.hanja}
      </text>
      <text
        x={CX}
        y={CY + 30}
        textAnchor="middle"
        fill={accent}
        fontSize="5"
        fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
        letterSpacing="2.8"
        opacity={0.9}
      >
        {meta.guardian}
      </text>
      <text
        x={CX}
        y={CY + 38}
        textAnchor="middle"
        fill={accent}
        fontSize="4.4"
        fontFamily="ui-monospace, monospace"
        letterSpacing="2.2"
        opacity={0.85}
      >
        {meta.numbers}
      </text>
    </g>
  )
}

function NameSeals({ seals, accent }: { seals: readonly NameSeal[]; accent: string }) {
  return (
    <g>
      {seals.map((seal, i) => {
        const p = polar(R.name, -90 + i * 72)
        const size = 5.5
        if (seal === 'hyung') {
          return (
            <g key={i}>
              <rect x={p.x - size} y={p.y - size} width={size * 2} height={size * 2} fill={INK.strong} fillOpacity={0.18} stroke={INK.strong} strokeWidth={SW.hair} />
              <line x1={p.x - size} y1={p.y - size} x2={p.x + size} y2={p.y + size} stroke={accent} strokeWidth={SW.base} />
            </g>
          )
        }
        return (
          <rect
            key={i}
            x={p.x - size}
            y={p.y - size}
            width={size * 2}
            height={size * 2}
            fill="none"
            stroke={seal === 'empty' ? INK.faint : INK.hair}
            strokeWidth={SW.hair}
          />
        )
      })}
    </g>
  )
}

function NumerologyRing({ digits }: { digits: readonly number[] }) {
  const count = digits.length
  return (
    <g>
      {digits.map((digit, i) => {
        const sides = digit === 1 ? 32 : Math.max(3, digit > 12 ? 9 : digit)
        const r = R.numIn + ((R.numOut - R.numIn) * i) / Math.max(1, count - 1)
        const rot = -90 + i * 7
        const labelAt = polar(r - 1, rot)
        return (
          <g key={i}>
            <polygon
              points={polyPoints(sides, r, rot)}
              fill="none"
              stroke={INK.base}
              strokeWidth={SW.hair}
            />
            <text
              x={labelAt.x}
              y={labelAt.y + 1.6}
              textAnchor="middle"
              fill={INK.strong}
              fontSize="5.2"
              fontFamily="ui-monospace, monospace"
              letterSpacing="1.4"
            >
              {digit}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function PrismHex({ dentAxis, accent }: { dentAxis: number; accent: string }) {
  const pts: Pt[] = []
  for (let i = 0; i < 6; i += 1) {
    const r = i === dentAxis ? R.prism * 0.72 : R.prism
    pts.push(polar(r, -90 + i * 60))
  }
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z'
  const dent = pts[dentAxis]!
  return (
    <g>
      <path d={d} fill="none" stroke={INK.base} strokeWidth={SW.base} />
      <circle cx={dent.x} cy={dent.y} r="1.6" fill={accent} stroke="none" />
    </g>
  )
}

function LuoshuSquare({ sealed, accent }: { sealed: readonly number[]; accent: string }) {
  const halfDiag = R.luoshu
  const half = round(halfDiag / Math.SQRT2)
  const cell = round((half * 2) / 3)
  const originX = round(CX - half)
  const originY = round(CY - half)
  const order: readonly number[] = [4, 9, 2, 3, 5, 7, 8, 1, 6]
  return (
    <g>
      <rect
        x={originX}
        y={originY}
        width={half * 2}
        height={half * 2}
        fill="none"
        stroke={INK.base}
        strokeWidth={SW.hair}
      />
      {order.map((palace, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = originX + col * cell
        const y = originY + row * cell
        const covered = sealed.includes(palace)
        return (
          <g key={palace}>
            <rect x={x} y={y} width={cell} height={cell} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
            {covered ? (
              <>
                <rect x={x + 2} y={y + 2} width={cell - 4} height={cell - 4} fill={INK.strong} fillOpacity={0.16} stroke="none" />
                <line x1={x + 3} y1={y + 3} x2={x + cell - 3} y2={y + cell - 3} stroke={accent} strokeWidth={SW.base} />
              </>
            ) : (
              <text
                x={x + cell / 2}
                y={y + cell / 2 + 2.2}
                textAnchor="middle"
                fill={INK.hair}
                fontSize="6"
                fontFamily="ui-serif, serif"
                letterSpacing="1.6"
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

function IchingRing({ lines, emptySeats }: { lines: readonly boolean[]; emptySeats: readonly number[] }) {
  const stack = polar(R.iching - 6, 22.5)
  return (
    <g>
      {TRIGRAMS.map((tri, i) => {
        const p = polar(R.iching, 90 - i * 45)
        return <Trigram key={tri.label} bits={tri.bits} x={p.x} y={p.y} scale={0.95} />
      })}
      {lines.map((yang, i) => {
        const y = stack.y - 11 + (5 - i) * 4.2
        const w = 11
        if (yang) {
          return <line key={i} x1={stack.x - w} y1={y} x2={stack.x + w} y2={y} stroke={INK.base} strokeWidth={SW.hair} />
        }
        return (
          <g key={i}>
            <line x1={stack.x - w} y1={y} x2={stack.x - 2} y2={y} stroke={INK.base} strokeWidth={SW.hair} />
            <line x1={stack.x + 2} y1={y} x2={stack.x + w} y2={y} stroke={INK.base} strokeWidth={SW.hair} />
          </g>
        )
      })}
      {RELATIVES.map((label, i) => {
        const p = polar(R.iching + 16, -90 + i * 72)
        const vacant = emptySeats.includes(i)
        if (vacant) {
          return <rect key={label} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
        }
        return (
          <text
            key={label}
            x={p.x}
            y={p.y + 2}
            textAnchor="middle"
            fill={INK.hair}
            fontSize="4.4"
            fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
            letterSpacing="1.8"
          >
            {label}
          </text>
        )
      })}
    </g>
  )
}

function SajuRing({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const pts = spec.sajuChars.map((_, i) => polar(R.saju, -90 + i * 45))
  return (
    <g>
      {spec.sajuChung.map(([a, b]) => (
        <line
          key={`c${a}-${b}`}
          x1={pts[a]!.x}
          y1={pts[a]!.y}
          x2={pts[b]!.x}
          y2={pts[b]!.y}
          stroke={INK.base}
          strokeWidth={SW.hair}
        />
      ))}
      {spec.sajuHap.map(([a, b]) => (
        <line
          key={`h${a}-${b}`}
          x1={pts[a]!.x}
          y1={pts[a]!.y}
          x2={pts[b]!.x}
          y2={pts[b]!.y}
          stroke={accent}
          strokeWidth={SW.hair}
          opacity={0.7}
        />
      ))}
      {spec.sajuChars.map((ch, i) => {
        const p = pts[i]!
        return (
          <g key={`${ch.hanja}-${i}`}>
            {ch.isDayMaster ? (
              <rect
                x={p.x - 7}
                y={p.y - 7}
                width={14}
                height={14}
                fill="none"
                stroke={accent}
                strokeWidth={SW.base}
              />
            ) : (
              <circle cx={p.x} cy={p.y} r="6.2" fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
            )}
            <text
              x={p.x}
              y={p.y + 2.6}
              textAnchor="middle"
              fill={ch.isDayMaster ? accent : INK.strong}
              fontSize="7"
              fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
              letterSpacing="1.4"
            >
              {ch.hanja}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function AstroRings({
  planets,
  ascendant,
  accent,
}: {
  planets: readonly PlanetMark[]
  ascendant: number | null
  accent: string
}) {
  return (
    <g>
      {SIGN_ABBR.map((label, i) => {
        const mid = i * 30 + 15
        const p = polar(R.astro + 8, 180 - mid)
        const a0 = polar(R.astro, 180 - i * 30)
        const a1 = polar(R.astro, 180 - (i + 1) * 30)
        return (
          <g key={label}>
            <line x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={INK.hair} strokeWidth={SW.hair} />
            <text
              x={p.x}
              y={p.y + 1.6}
              textAnchor="middle"
              fill={INK.hair}
              fontSize="4"
              fontFamily="ui-monospace, monospace"
              letterSpacing="1.8"
            >
              {label}
            </text>
          </g>
        )
      })}
      {ascendant != null
        ? HOUSE_NUM.map((label, i) => {
            const start = ascendant + i * 30
            const mid = start + 15
            const inner = polar(R.house, 180 - start)
            const outer = polar(R.astro - 6, 180 - start)
            const tp = polar((R.house + R.astro - 6) / 2, 180 - mid)
            return (
              <g key={label}>
                <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={INK.faint} strokeWidth={SW.hair} />
                <text
                  x={tp.x}
                  y={tp.y + 1.4}
                  textAnchor="middle"
                  fill={INK.hair}
                  fontSize="3.4"
                  fontFamily="ui-serif, serif"
                  letterSpacing="1.2"
                >
                  {label}
                </text>
              </g>
            )
          })
        : null}
      {ascendant != null ? (
        <line
          x1={zodiacPoint(R.house - 4, ascendant).x}
          y1={zodiacPoint(R.house - 4, ascendant).y}
          x2={zodiacPoint(R.astro + 14, ascendant).x}
          y2={zodiacPoint(R.astro + 14, ascendant).y}
          stroke={accent}
          strokeWidth={SW.base}
        />
      ) : null}
      {planets.map((planet) => {
        const p = zodiacPoint(R.astro - 2, planet.longitude)
        return <PlanetGlyph key={planet.id} id={planet.id} x={p.x} y={p.y} accent={accent} />
      })}
    </g>
  )
}

function ZiweiRing({ palaces, accent }: { palaces: TalismanSpec['palaces']; accent: string }) {
  if (palaces == null) {
    return hairCircle(R.ziwei, 0.35)
  }
  return (
    <g>
      {palaces.map((palace, i) => {
        const a0 = -90 + i * 30
        const a1 = a0 + 30
        const inner0 = polar(R.ziwei - 16, a0)
        const inner1 = polar(R.ziwei - 16, a1)
        const outer0 = polar(R.ziwei + 10, a0)
        const outer1 = polar(R.ziwei + 10, a1)
        const mid = polar(R.ziwei - 3, a0 + 15)
        const d = `M${inner0.x.toFixed(1)},${inner0.y.toFixed(1)} L${outer0.x.toFixed(1)},${outer0.y.toFixed(1)} L${outer1.x.toFixed(1)},${outer1.y.toFixed(1)} L${inner1.x.toFixed(1)},${inner1.y.toFixed(1)} Z`
        return (
          <g key={`${palace.name}-${i}`}>
            <path d={d} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
            {palace.sealed ? (
              <>
                <path d={d} fill={INK.strong} fillOpacity={0.14} stroke="none" />
                <line x1={inner0.x} y1={inner0.y} x2={outer1.x} y2={outer1.y} stroke={accent} strokeWidth={SW.base} />
              </>
            ) : null}
            {palace.empty || palace.sealed ? null : (
              <text
                x={mid.x}
                y={mid.y + 1.8}
                textAnchor="middle"
                fill={INK.base}
                fontSize="5"
                fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
                letterSpacing="1.6"
              >
                {palace.name}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function OuterCalendars({ spec }: { spec: TalismanSpec }) {
  return (
    <g>
      {Array.from({ length: 27 }, (_, i) => {
        const p0 = polar(R.sukuyou - 4, 90 - (i * 360) / 27)
        const p1 = polar(R.sukuyou + (i === spec.sukuyouIndex ? 8 : 4), 90 - (i * 360) / 27)
        return (
          <line
            key={i}
            x1={p0.x}
            y1={p0.y}
            x2={p1.x}
            y2={p1.y}
            stroke={i === spec.sukuyouIndex ? INK.strong : INK.hair}
            strokeWidth={i === spec.sukuyouIndex ? SW.base : SW.hair}
          />
        )
      })}
      {hairCircle(R.tzA, 0.8)}
      {hairCircle(R.tzB, 0.8)}
      {Array.from({ length: 13 }, (_, i) => {
        const p = polar(R.tzA, 90 - (i * 360) / 13)
        const on = i + 1 === spec.tzolkinTone
        return <circle key={`t${i}`} cx={p.x} cy={p.y} r={on ? 1.8 : 0.8} fill={on ? INK.strong : INK.hair} stroke="none" />
      })}
      {Array.from({ length: 20 }, (_, i) => {
        const p = polar(R.tzB, 90 - (i * 360) / 20)
        const on = i + 1 === spec.tzolkinNawal
        return <rect key={`n${i}`} x={p.x - 1} y={p.y - 1} width={on ? 2.4 : 1.4} height={on ? 2.4 : 1.4} fill={on ? INK.strong : INK.hair} stroke="none" />
      })}
    </g>
  )
}

function Border({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const suits = [
    { x: CX - R.border * 0.72, y: CY - R.border * 0.72, mark: 'wands' },
    { x: CX + R.border * 0.72, y: CY - R.border * 0.72, mark: 'cups' },
    { x: CX - R.border * 0.72, y: CY + R.border * 0.72, mark: 'swords' },
    { x: CX + R.border * 0.72, y: CY + R.border * 0.72, mark: 'pentacles' },
  ] as const
  return (
    <g>
      {hairCircle(R.border, 0.7)}
      {suits.map((suit) => (
        <g key={suit.mark} transform={`translate(${suit.x} ${suit.y})`} stroke={INK.hair} fill="none" strokeWidth={SW.hair}>
          {suit.mark === 'wands' ? <polyline points="0,-6 0,6 M-3,-2 0,-6 3,-2" /> : null}
          {suit.mark === 'cups' ? <polyline points="-4,-4 4,-4 4,1 0,6 -4,1 -4,-4" /> : null}
          {suit.mark === 'swords' ? <line x1="0" y1="-6" x2="0" y2="6" /> : null}
          {suit.mark === 'pentacles' ? <polygon points="0,-5 4.8,-1.6 3,4.2 -3,4.2 -4.8,-1.6" /> : null}
        </g>
      ))}
      {spec.bindrune ? <Bindrune x={CX + R.border - 6} y={CY} accent={accent} /> : null}
      <text
        x={CX}
        y={CY + R.border + 14}
        textAnchor="middle"
        fill={INK.hair}
        fontSize="4.2"
        fontFamily="ui-monospace, monospace"
        letterSpacing="3.6"
      >
        {spec.dateLabel}  ·  {spec.sessionId}  ·  {ELEMENT_META[spec.element].hanja}
        {spec.mode === 'drain' ? '  EXCESS' : '  DEFICIT'}
        {spec.purposeWealth ? '  ·  財' : ''}
      </text>
    </g>
  )
}

function Fubu({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const top = 36
  const bot = 964
  const gap = R.core + 6
  return (
    <g stroke={accent} fill="none" strokeLinecap="butt">
      <line x1={CX} y1={top + 22} x2={CX} y2={CY - gap} strokeWidth={SW.base} />
      <line x1={CX} y1={CY + gap} x2={CX} y2={bot - 22} strokeWidth={SW.base} />
      <line x1={CX - 16} y1={top} x2={CX + 16} y2={top} strokeWidth={SW.emph} />
      <line x1={CX - 10} y1={top} x2={CX - 10} y2={top + 10} strokeWidth={SW.hair} />
      <line x1={CX} y1={top} x2={CX} y2={top + 14} strokeWidth={SW.hair} />
      <line x1={CX + 10} y1={top} x2={CX + 10} y2={top + 10} strokeWidth={SW.hair} />
      <polyline points={`${CX - 12},${top + 18} ${CX},${top + 8} ${CX + 12},${top + 18}`} strokeWidth={SW.base} />
      {spec.purposeWealth ? (
        <text
          x={CX + 14}
          y={CY - gap - 8}
          fill={accent}
          stroke="none"
          fontSize="22"
          fontFamily="ui-serif, 'Noto Serif CJK KR', serif"
          letterSpacing="4"
        >
          財
        </text>
      ) : (
        <>
          <line x1={CX - 7} y1={CY - 70} x2={CX + 7} y2={CY - 70} strokeWidth={SW.hair} />
          <line x1={CX - 7} y1={CY + 70} x2={CX + 7} y2={CY + 70} strokeWidth={SW.hair} />
        </>
      )}
      <polyline points={`${CX - 10},${bot - 18} ${CX},${bot} ${CX + 10},${bot - 18}`} strokeWidth={SW.emph} />
      <line x1={CX - 14} y1={bot} x2={CX + 14} y2={bot} strokeWidth={SW.base} />
    </g>
  )
}

function BleedGrid(): ReactNode {
  const lines: ReactNode[] = []
  for (let v = -400; v <= 1400; v += 50) {
    lines.push(
      <line key={`v${v}`} x1={v} y1={-400} x2={v} y2={1400} stroke={INK.faint} strokeWidth={SW.hair} />,
      <line key={`h${v}`} x1={-400} y1={v} x2={1400} y2={v} stroke={INK.faint} strokeWidth={SW.hair} />,
    )
  }
  return <g opacity={0.55}>{lines}</g>
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
      style={{ width: '100%', height: '100%', display: 'block', background: '#07080c' }}
    >
      <defs>
        <clipPath id={`${uid}-frame`}>
          <rect x={vx} y={vy} width={vw} height={vh} />
        </clipPath>
      </defs>
      <rect x={vx} y={vy} width={vw} height={vh} fill="#07080c" />
      <rect x={vx} y={vy} width={56} height={vh} fill="#6b5b8c" fillOpacity={0.045} />
      <rect x={vx + vw - 56} y={vy} width={56} height={vh} fill="#6b5b8c" fillOpacity={0.045} />
      <g clipPath={`url(#${uid}-frame)`}>
        <BleedGrid />
        {hairCircle(R.numOut, 0.35)}
        {hairCircle(R.saju, 0.25)}
        {hairCircle(R.ziwei, 0.2)}
        <Fubu spec={spec} accent={accent} />
        <OuterCalendars spec={spec} />
        <ZiweiRing palaces={spec.palaces} accent={accent} />
        <AstroRings planets={spec.planets} ascendant={spec.ascendant} accent={accent} />
        <SajuRing spec={spec} accent={accent} />
        <IchingRing lines={spec.ichingLines} emptySeats={spec.bokjangEmpty} />
        <LuoshuSquare sealed={spec.luoshuSealed} accent={accent} />
        <PrismHex dentAxis={spec.prismDentAxis} accent={accent} />
        <NumerologyRing digits={spec.numerology} />
        <NameSeals seals={spec.nameSeals} accent={accent} />
        <Centre spec={spec} accent={accent} />
        <Border spec={spec} accent={accent} />
      </g>
    </svg>
  )
}
