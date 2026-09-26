/**
 * Concentric 부적. Two weights:
 * major — core, 사주, 자미, 낙서, 주역, 점성 (type sized for phone)
 * minor — 수비, PRISM, 숙요, 촐킨, 타로, 룬 (rim engraving, no labels)
 * Seals cover with lattice, not filled planes. Density peaks at the core.
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

const ORIGIN = 26
const CELL = 316
const CORE = 158
const SAJU_R = 204
const TRIGRAM_R = 248
const SIGN_R = 286
const ZIWEI_IN = 332
const ZIWEI_OUT = 398

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

/** Slight, deterministic radius jitter — not a perfect arithmetic series. */
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

function PhysicsGlyph({ element, accent }: { element: ElementKey; accent: string }) {
  const label = {
    fill: accent,
    stroke: 'none' as const,
    fontFamily: 'ui-monospace, monospace',
  }
  return (
    <g transform={`translate(${CX} ${CY - 38})`} stroke={accent} fill="none" strokeLinecap="butt">
      {element === 'water' ? (
        <g strokeWidth={2.4}>
          <path d="M-34 10 L0 34 L34 10" />
          <path d="M-22 0 L0 16 L22 0" />
          <circle cy="34" r="3.5" fill={accent} stroke="none" />
          <text x="18" y="-6" fontSize="24" letterSpacing="1" {...label}>
            G
          </text>
        </g>
      ) : null}
      {element === 'wood' ? (
        <g strokeWidth={2.4}>
          <line x1="0" y1="-32" x2="0" y2="28" />
          <line x1="-26" y1="-26" x2="26" y2="26" />
          <line x1="26" y1="-26" x2="-26" y2="26" />
          <text x="14" y="18" fontSize="16" letterSpacing="0.8" {...label}>
            ds²
          </text>
        </g>
      ) : null}
      {element === 'earth' ? (
        <g strokeWidth={2.4}>
          <line x1="0" y1="-30" x2="0" y2="4" />
          <line x1="0" y1="4" x2="-22" y2="30" />
          <line x1="0" y1="4" x2="22" y2="30" />
          <path d="M16 -8 H30 L24 2 H34" />
          <text x="-46" y="-8" fontSize="15" letterSpacing="1.4" {...label}>
            W Z
          </text>
        </g>
      ) : null}
      {element === 'metal' ? (
        <g strokeWidth={2.2}>
          <circle cx="0" cy="-16" r="7" />
          <circle cx="-16" cy="16" r="7" />
          <circle cx="16" cy="16" r="7" />
          <line x1="0" y1="-9" x2="-12" y2="10" />
          <line x1="0" y1="-9" x2="12" y2="10" />
          <line x1="-9" y1="16" x2="9" y2="16" />
          <text x="26" y="4" fontSize="14" letterSpacing="0.6" {...label}>
            SU(3)
          </text>
        </g>
      ) : null}
      {element === 'fire' ? (
        <g strokeWidth={2.4}>
          <polyline points="-36,6 -28,-2 -20,6 -12,-2 -4,6 4,-2 12,6 20,-2 28,6 36,-2" />
          <polyline points="0,-28 -8,-20 0,-12 -8,-4 0,4 -8,12 0,20 -8,28 0,36" />
          <text x="16" y="-14" fontSize="28" fontFamily="ui-serif, serif" stroke="none" fill={accent}>
            γ
          </text>
        </g>
      ) : null}
    </g>
  )
}

function Trigram({ bits, x, y }: { bits: readonly boolean[]; x: number; y: number }) {
  const w = 18
  return (
    <g transform={`translate(${x} ${y})`} stroke={INK.strong} strokeWidth={1.8} strokeLinecap="butt">
      {bits.map((yang, i) => {
        const yy = (i - 1) * 5.6
        if (yang) return <line key={i} x1={-w / 2} y1={yy} x2={w / 2} y2={yy} />
        return (
          <g key={i}>
            <line x1={-w / 2} y1={yy} x2={-2.4} y2={yy} />
            <line x1={2.4} y1={yy} x2={w / 2} y2={yy} />
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

function Centre({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const meta = ELEMENT_META[spec.element]
  const drain = spec.mode === 'drain'
  const barsTop = CY + 22
  const aim = ELEMENT_AIM[spec.element]
  const gap0 = (aim + 150) % 360
  const gap1 = gap0 + 38
  return (
    <g>
      {drain ? (
        <>
          <polyline
            points={arcPoly(CORE, gap1, gap0 + 360, 2)}
            fill="none"
            stroke={accent}
            strokeWidth={3.4}
          />
          <polyline
            points={arcPoly(CORE - 12, gap1 + 8, gap0 + 348, 3)}
            fill="none"
            stroke={accent}
            strokeWidth={1.2}
          />
          {Array.from({ length: 14 }, (_, i) => {
            const a = aim - 70 + i * 10
            const a0 = polar(CORE + 2, a)
            const a1 = polar(CORE + 48, a)
            return <line key={i} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.emph} />
          })}
        </>
      ) : (
        <>
          <circle cx={CX} cy={CY} r={CORE} fill={accent} fillOpacity={0.62} stroke="none" />
          <polyline
            points={arcPoly(CORE, gap1, gap0 + 360, 1)}
            fill="none"
            stroke={accent}
            strokeWidth={3.2}
          />
          {Array.from({ length: 9 }, (_, i) => {
            const a = aim - 36 + i * 9
            const a0 = polar(CORE - 18, a)
            const a1 = polar(CORE - 5, a)
            return <line key={i} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.base} />
          })}
        </>
      )}
      <g fill={drain ? INK.strong : '#fff'}>
        {spec.ichingLines.map((yang, i) => {
          const y = barsTop + i * 17
          const x0 = CX - 70
          const x1 = CX + 70
          if (yang) return <rect key={i} x={x0} y={y} width={x1 - x0} height={8} />
          return (
            <g key={i}>
              <rect x={x0} y={y} width={56} height={8} />
              <rect x={x1 - 56} y={y} width={56} height={8} />
            </g>
          )
        })}
      </g>
      <PhysicsGlyph element={spec.element} accent={accent} />
      <Hanjatext x={CX} y={CY - 104} size={62} fill={accent}>
        {meta.hanja}
      </Hanjatext>
      <text
        x={CX}
        y={CY + 136}
        textAnchor="middle"
        fill={accent}
        fontSize="18"
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
  return <path d={bandPath(CORE + 2, ZIWEI_OUT + 8, aim - 16, aim + 16, 2)} fill={accent} opacity={0.16} />
}

function SectorRays({ element, accent }: { element: ElementKey; accent: string }) {
  const aim = ELEMENT_AIM[element]
  const inner = polar(CORE + 2, aim)
  const edge0 = polarJ(ZIWEI_OUT + 10, aim - 17, 4)
  const edge1 = polarJ(ZIWEI_OUT + 10, aim + 17, 5)
  return (
    <g>
      <line x1={inner.x} y1={inner.y} x2={edge0.x} y2={edge0.y} stroke={accent} strokeWidth={2.8} />
      <line x1={inner.x} y1={inner.y} x2={edge1.x} y2={edge1.y} stroke={accent} strokeWidth={2.8} />
    </g>
  )
}

function Spine({ accent, wealth }: { accent: string; wealth: boolean }) {
  const gap = CORE + 4
  return (
    <g fill={accent} stroke={accent} strokeLinecap="butt">
      <rect x={CX - 4} y={18} width={8} height={CY - gap - 18} />
      <rect x={CX - 4} y={CY + gap} width={8} height={980 - (CY + gap)} />
      <rect x={CX - 30} y={10} width={60} height={6} />
      <polygon points={`${CX - 18},30 ${CX},14 ${CX + 18},30`} fill="none" strokeWidth={SW.emph} />
      {wealth ? (
        <>
          <rect x={CX - 72} y={22} width={144} height={122} fill={GROUND} stroke="none" />
          <Hanjatext x={CX} y={118} size={96} fill={accent}>
            財
          </Hanjatext>
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
  const pts = spec.sajuChars.map((_, i) => polarJ(SAJU_R, -67.5 + i * 45, i))
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
              <rect x={p.x - 22} y={p.y - 22} width={44} height={44} fill={GROUND} stroke={accent} strokeWidth={SW.emph} />
            ) : (
              <circle cx={p.x} cy={p.y} r={22} fill={GROUND} stroke={INK.hair} strokeWidth={SW.hair} />
            )}
            <Hanjatext x={p.x} y={p.y} size={34} fill={ch.isDayMaster ? accent : INK.strong} dy={12}>
              {ch.hanja}
            </Hanjatext>
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
          const left = polarJ(TRIGRAM_R - 22, a0 + 4, i)
          const right = polarJ(TRIGRAM_R - 22, a0 + 41, i)
          const leftO = polarJ(TRIGRAM_R + 22, a0 + 4, i)
          const rightO = polarJ(TRIGRAM_R + 22, a0 + 41, i)
          return (
            <g key={`gap-${i}`}>
              <line x1={left.x} y1={left.y} x2={leftO.x} y2={leftO.y} stroke={INK.hair} strokeWidth={SW.hair} />
              <line x1={right.x} y1={right.y} x2={rightO.x} y2={rightO.y} stroke={INK.hair} strokeWidth={SW.hair} />
            </g>
          )
        }
        const mid = polarJ(TRIGRAM_R, a0 + 22.5, i)
        return (
          <g key={i} opacity={0.7}>
            <path d={bandPath(TRIGRAM_R - 16, TRIGRAM_R + 16, a0 + 3, a0 + 42, i)} fill="none" stroke={INK.base} strokeWidth={SW.hair} />
            <Trigram bits={tri.bits} x={mid.x} y={mid.y} />
          </g>
        )
      })}
    </g>
  )
}

function CellSeal({
  x,
  y,
  w,
  h,
  accent,
  hatchId,
}: {
  x: number
  y: number
  w: number
  h: number
  accent: string
  hatchId: string
}) {
  const pad = 22
  const cx = x + w / 2
  const cy = y + h / 2
  return (
    <g>
      <rect x={x + 8} y={y + 8} width={w - 16} height={h - 16} fill={`url(#${hatchId})`} stroke="none" />
      <line x1={x + pad} y1={y + pad} x2={x + w - pad} y2={y + h - pad} stroke={accent} strokeWidth={5.5} />
      <line x1={x + w - pad} y1={y + pad} x2={x + pad} y2={y + h - pad} stroke={accent} strokeWidth={5.5} />
      <rect
        x={cx - 20}
        y={cy - 20}
        width={40}
        height={40}
        fill="none"
        stroke={accent}
        strokeWidth={2.2}
        transform={`rotate(45 ${cx} ${cy})`}
      />
      <line x1={cx - 34} y1={cy} x2={cx + 34} y2={cy} stroke={accent} strokeWidth={1.6} />
      <line x1={cx} y1={cy - 34} x2={cx} y2={cy + 34} stroke={accent} strokeWidth={1.6} />
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={accent} strokeWidth={1.6} />
    </g>
  )
}

function Luoshu({ sealed, accent, hatchId }: { sealed: readonly number[]; accent: string; hatchId: string }) {
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
              strokeWidth={covered ? 3.2 : SW.hair}
            />
          )
        }
        const dx = col === 0 ? x + 52 : col === 2 ? x + CELL - 52 : x + CELL / 2
        const dy = row === 0 ? y + 58 : row === 2 ? y + CELL - 36 : y + CELL / 2
        return (
          <g key={palace}>
            <rect x={x} y={y} width={CELL} height={CELL} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
            {covered ? (
              <CellSeal x={x} y={y} w={CELL} h={CELL} accent={accent} hatchId={hatchId} />
            ) : (
              <text x={dx} y={dy} textAnchor="middle" fill={INK.base} fontSize="30" fontFamily="ui-serif, serif">
                {palace}
              </text>
            )}
          </g>
        )
      })}
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

function ZiweiRing({
  palaces,
  accent,
  hatchId,
}: {
  palaces: TalismanSpec['palaces']
  accent: string
  hatchId: string
}) {
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
          const c0 = polarJ(ZIWEI_IN, a0 + 8, i)
          const c1 = polarJ(rOut + 8, a1 - 8, i + 3)
          return (
            <g key={palace.name}>
              <path d={bandPath(ZIWEI_IN, rOut + 10, a0 + 1, a1 - 1, i)} fill={`url(#${hatchId})`} />
              <line x1={c0.x} y1={c0.y} x2={c1.x} y2={c1.y} stroke={accent} strokeWidth={4.5} />
              <polyline
                points={arcPoly(rOut + 4, a0 + 2, a1 - 2, i)}
                fill="none"
                stroke={accent}
                strokeWidth={SW.base}
              />
            </g>
          )
        }
        return (
          <g key={palace.name}>
            <path d={bandPath(ZIWEI_IN, rOut, a0 + 1.2, a1 - 1.2, i)} fill={INK.strong} opacity={0.12} />
            <polyline
              points={arcPoly(rOut, a0 + 1.2, a1 - 1.2, i)}
              fill="none"
              stroke={INK.hair}
              strokeWidth={SW.base}
            />
            <polyline
              points={arcPoly(ZIWEI_IN, a0 + 1.2, a1 - 1.2, i + 1)}
              fill="none"
              stroke={INK.faint}
              strokeWidth={SW.hair}
            />
            <Hanjatext x={mid.x} y={mid.y} size={28} fill={INK.strong} dy={10}>
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
        const p1 = polarJ(ZIWEI_OUT + 22, a - 13, i)
        const p2 = polarJ(ZIWEI_IN - 18, a, i)
        const p3 = polarJ(ZIWEI_OUT + 22, a + 13, i)
        const seat = polar(ZIWEI_IN + 6, a)
        return (
          <g key={i}>
            <path
              d={`M${p1.x},${p1.y} L${p2.x},${p2.y} L${p3.x},${p3.y} Z`}
              fill={GROUND}
              stroke={INK.strong}
              strokeWidth={SW.emph}
            />
            <rect
              x={seat.x - 9}
              y={seat.y - 9}
              width={18}
              height={18}
              fill="none"
              stroke={INK.strong}
              strokeWidth={SW.base}
              transform={`rotate(45 ${seat.x} ${seat.y})`}
            />
          </g>
        )
      })}
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
  return (
    <g>
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
            fontSize="15"
            fontFamily="ui-monospace, monospace"
            letterSpacing="1"
          >
            {label}
          </text>
        )
      })}
      {planets.map((planet) => {
        const p = polarJ(SIGN_R + 24, 180 - planet.longitude, 2)
        return <PlanetGlyph key={planet.id} id={planet.id} x={p.x} y={p.y} />
      })}
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
          const p0 = polar(SIGN_R - 18, a)
          const p1 = polar(SIGN_R - 8, a)
          return <line key={`h${i}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={INK.faint} strokeWidth={SW.hair} />
        })
      )}
    </g>
  )
}

function MinorRim({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const dent = spec.prismDentAxis
  const hex: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const r = i === dent ? 418 : 448 + (i % 2 === 0 ? 6 : -4)
    const p = polarJ(r, -90 + i * 60, i)
    hex.push(`${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
  }
  return (
    <g opacity={0.26}>
      {spec.numerology.map((digit, i) => (
        <polygon
          key={digit + '-' + i}
          points={polyPoints(Math.max(3, Math.min(digit, 12)), 440 + i * 6, -80 + i * 9)}
          fill="none"
          stroke={INK.hair}
          strokeWidth={SW.hair}
        />
      ))}
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
      {(
        [
          ['wands', -1, -1],
          ['cups', 1, -1],
          ['swords', -1, 1],
          ['pentacles', 1, 1],
        ] as const
      ).map(([mark, sx, sy]) => {
        const x = CX + sx * 448
        const y = CY + sy * 448
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
        <g transform={`translate(${CX + 456} ${CY + 8})`} stroke={accent} fill="none" strokeWidth={SW.base}>
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
  return <g opacity={0.22}>{lines}</g>
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
  const hatchId = `${uid}-hatch`
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
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width="11" height="11" patternTransform="rotate(38)">
          <path d="M0 0 L0 11" stroke={accent} strokeWidth="2.1" />
          <path d="M0 0 L11 0" stroke={accent} strokeWidth="0.7" opacity="0.55" />
        </pattern>
      </defs>
      <rect x={vx} y={vy} width={vw} height={vh} fill={GROUND} />
      <g clipPath={`url(#${uid}-frame)`}>
        <BleedGrid />
        <g transform={leanTransform(spec.element, spec.mode === 'drain')}>
          <ElementSector element={spec.element} accent={accent} />
          <Luoshu sealed={spec.luoshuSealed} accent={accent} hatchId={hatchId} />
          <MinorRim spec={spec} accent={accent} />
          <AstroRing planets={spec.planets} ascendant={spec.ascendant} accent={accent} />
          <ZiweiRing palaces={spec.palaces} accent={accent} hatchId={hatchId} />
          <IchingGaps emptySeats={spec.bokjangEmpty} />
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
      </g>
    </svg>
  )
}
