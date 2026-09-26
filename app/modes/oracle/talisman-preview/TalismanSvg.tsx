/**
 * Concentric 부적. Three zones:
 *   dense carved core / textured middle (all scripts) / sparse rim
 * Seals BIND with closed locks. Hanja is OFL path data, never a CJK <text>.
 */
import type { ReactNode } from 'react'
import { isPrismColor } from '@/lib/oracle/engines/prism/tables'
import { PRISM_COLOR_HEX } from '@/lib/oracle/prism-swatches'
import { composeBindrune } from '@/lib/oracle/talisman/bindrune'
import { TALISMAN_GLYPH_UNITS, talismanGlyph } from '@/lib/oracle/talisman/glyphs'
import { TALISMAN_ZODIAC_IDS, talismanZodiac } from '@/lib/oracle/talisman/zodiac'
import { NawalGlyph } from './nawal-glyphs'
import {
  CIRCLE_CX,
  CIRCLE_CY,
  CIRCLE_SCALE,
  ELEMENT_META,
  MASTER_H,
  MASTER_W,
  type ElementKey,
  type FrameSpec,
  type PalaceMark,
  type PlanetMark,
  type TalismanSpec,
} from './variants'

function prismHex(id: string | undefined): string | null {
  if (!id || !isPrismColor(id)) return null
  return PRISM_COLOR_HEX[id]
}

const CX = 500
const CY = 500

const SW = { hair: 1.2, med: 3.0 } as const
export const TALISMAN_SW = SW
export const PHONE_RENDER_WIDTH = 390
export const SIZE_FLOOR_PX = 10
/** Canvas units that render as 10px on a 390-wide phone. */
export const SIZE_FLOOR_CANVAS = (SIZE_FLOOR_PX * 1000) / PHONE_RENDER_WIDTH
/** Local circle units after CIRCLE_SCALE 0.9. */
export const SIZE_FLOOR_CIRCLE = SIZE_FLOOR_CANVAS / CIRCLE_SCALE
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

function HanjaGlyph({
  x,
  y,
  size,
  fill,
  children,
  dy = 0,
  stroke,
  strokeWidth = 0,
}: {
  x: number
  y: number
  size: number
  fill: string
  children: string
  dy?: number
  stroke?: string
  strokeWidth?: number
}) {
  const chars = [...children]
  const maxH = Math.max(...chars.map((ch) => talismanGlyph(ch).bbox.h))
  const scale = size / maxH
  const total = chars.reduce((sum, ch) => sum + talismanGlyph(ch).advance * scale, 0)
  let cursor = -total / 2
  return (
    <g transform={`translate(${x} ${y + dy})`} fill={fill} stroke={stroke ?? 'none'} fillRule="evenodd">
      {chars.map((ch, i) => {
        const glyph = talismanGlyph(ch)
        const cx = glyph.bbox.x + glyph.bbox.w / 2
        const cy = glyph.bbox.y + glyph.bbox.h / 2
        const node = (
          <g key={`${ch}-${i}`} transform={`translate(${cursor + (glyph.advance * scale) / 2} 0) scale(${scale}) translate(${-cx} ${-cy})`}>
            <path
              data-hanja={ch}
              data-hanja-codepoint={glyph.codepoint}
              d={glyph.d}
              strokeWidth={strokeWidth / scale}
            />
          </g>
        )
        cursor += glyph.advance * scale
        return node
      })}
    </g>
  )
}

/** Stamped knot — circle bound by crossed cords. Replaces the lock/square UI. */
function SealKnot({ x, y, accent, scale = 1 }: { x: number; y: number; accent: string; scale?: number }) {
  return (
    <g data-seal-knot="true" transform={`translate(${x} ${y}) scale(${scale})`} stroke={accent} fill="none" strokeLinecap="butt">
      <circle r="18" strokeWidth={SW.med} />
      <line x1="-13" y1="-13" x2="13" y2="13" strokeWidth={SW.med} />
      <line x1="13" y1="-13" x2="-13" y2="13" strokeWidth={SW.med} />
      <line x1="-16" y1="0" x2="16" y2="0" strokeWidth={SW.hair} />
      <line x1="0" y1="-16" x2="0" y2="16" strokeWidth={SW.hair} />
    </g>
  )
}

function BindruneSigil({
  stones,
  x,
  y,
  accent,
}: {
  stones: TalismanSpec['bindruneRunes']
  x: number
  y: number
  accent: string
}) {
  const mark = composeBindrune(stones)
  return (
    <path
      data-bindrune={mark.staveOnly ? 'stave' : 'merged'}
      transform={`translate(${x} ${y})`}
      d={mark.d}
      fill="none"
      stroke={accent}
      strokeWidth={SW.med}
      strokeLinecap="butt"
    />
  )
}

function PhysicsGlyph({
  element,
  accent,
  x = CX,
  y = CY + 8,
  height = 70,
}: {
  element: ElementKey
  accent: string
  x?: number
  y?: number
  height?: number
}) {
  const label = { fill: accent, stroke: 'none' as const, fontFamily: 'ui-monospace, monospace' }
  const scale = height / 80
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={accent} fill="none" strokeLinecap="butt" data-physics="true">
      {element === 'water' ? (
        <g strokeWidth={SW.med}>
          <path d="M-40 8 L0 38 L40 8" />
          <path d="M-26 -4 L0 16 L26 -4" />
          <circle cy="38" r="7" fill={accent} stroke="none" />
          <text x="22" y="-10" fontSize="36" letterSpacing="1" {...label}>
            G
          </text>
        </g>
      ) : null}
      {element === 'wood' ? (
        <g strokeWidth={SW.med}>
          <line x1="0" y1="-36" x2="0" y2="32" />
          <line x1="-30" y1="-30" x2="30" y2="30" />
          <line x1="30" y1="-30" x2="-30" y2="30" />
          <text x="16" y="22" fontSize="36" letterSpacing="0.8" {...label}>
            ds²
          </text>
        </g>
      ) : null}
      {element === 'earth' ? (
        <g strokeWidth={SW.med}>
          <line x1="0" y1="-34" x2="0" y2="4" />
          <line x1="0" y1="4" x2="-26" y2="34" />
          <line x1="0" y1="4" x2="26" y2="34" />
          <path d="M18 -10 H36 L28 2 H40" />
          <text x="-52" y="-10" fontSize="36" letterSpacing="1.4" {...label}>
            W Z
          </text>
        </g>
      ) : null}
      {element === 'metal' ? (
        <g strokeWidth={SW.med}>
          <circle cx="0" cy="-18" r="9" />
          <circle cx="-18" cy="18" r="9" />
          <circle cx="18" cy="18" r="9" />
          <line x1="0" y1="-9" x2="-13" y2="12" />
          <line x1="0" y1="-9" x2="13" y2="12" />
          <line x1="-10" y1="18" x2="10" y2="18" />
          <text x="28" y="6" fontSize="36" letterSpacing="0.6" {...label}>
            SU(3)
          </text>
        </g>
      ) : null}
      {element === 'fire' ? (
        <g strokeWidth={SW.med}>
          <polyline points="-42,8 -32,-2 -22,8 -12,-2 -2,8 8,-2 18,8 28,-2 38,8" />
          <polyline points="0,-34 -10,-24 0,-14 -10,-4 0,6 -10,16 0,26 -10,36 0,44" />
          <text x="18" y="-16" fontSize="40" fontFamily="ui-serif, serif" stroke="none" fill={accent}>
            γ
          </text>
        </g>
      ) : null}
    </g>
  )
}

function BalancedCore(): ReactNode {
  const radius = 78
  const rot = 90
  return (
    <g data-centre="balanced">
      <polygon points={polyPoints(5, radius, rot)} fill="none" stroke={INK.base} strokeWidth={SW.hair} />
      {Array.from({ length: 5 }, (_, i) => {
        const p = polarJ(radius, rot + (i * 360) / 5, i)
        return <circle key={i} cx={p.x} cy={p.y} r="8" fill={INK.strong} stroke="none" />
      })}
    </g>
  )
}

function FollowSpiral({ accent }: { accent: string }) {
  const pts: string[] = []
  for (let i = 0; i <= 80; i += 1) {
    const t = i / 80
    const r = 22 + t * (CORE - 28)
    const p = polar(r, t * 900)
    pts.push(`${p.x},${p.y}`)
  }
  return (
    <polyline
      data-centre="follow-spiral"
      points={pts.join(' ')}
      fill="none"
      stroke={accent}
      strokeWidth={SW.med}
      strokeLinecap="butt"
    />
  )
}

function Centre({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  if (spec.element == null) return <BalancedCore />
  const element = spec.element
  const meta = ELEMENT_META[element]
  const drain = spec.mode === 'drain'
  const follow = spec.mode === 'follow'
  const aim = ELEMENT_AIM[element]
  const wash = spec.intensity === 'soft' ? 0.22 : 0.42
  return (
    <g
      data-centre={follow ? 'follow' : spec.intensity === 'soft' ? 'soft' : 'full'}
      data-intensity={spec.intensity ?? 'full'}
      data-core={drain ? 'drain' : 'fill'}
    >
      {drain ? (
        <>
          <circle cx={CX} cy={CY} r={CORE} fill={GROUND} stroke={accent} strokeWidth={SW.med} data-drain-shell="true" />
          <circle cx={CX} cy={CY} r={CORE - 18} fill="none" stroke={accent} strokeWidth={SW.hair} data-drain-gap="true" />
        </>
      ) : (
        <circle cx={CX} cy={CY} r={CORE} fill={accent} fillOpacity={wash} stroke="none" data-fill-core="true" />
      )}
      {drain
        ? Array.from({ length: 14 }, (_, i) => {
            const a = aim - 70 + i * (140 / 13)
            const a0 = polar(CORE + 4, a)
            const a1 = polar(CORE + 52, a)
            return <line key={`vent-${i}`} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.med} data-ray="out" />
          })
        : Array.from({ length: 16 }, (_, i) => {
            const a = aim - 80 + i * 10
            const a0 = polar(CORE - 6, a)
            const a1 = polar(36, a)
            return <line key={`in-${i}`} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={accent} strokeWidth={SW.med} data-ray="in" />
          })}
      {follow ? <FollowSpiral accent={accent} /> : null}
      <PhysicsGlyph element={element} accent={accent} height={90} />
      <g data-centre-hanja={meta.hanja} data-centre-hanja-size="140">
        <HanjaGlyph x={CX} y={CY - 36} size={140} fill={accent}>
          {meta.hanja}
        </HanjaGlyph>
      </g>
    </g>
  )
}

function ElementSector({ element, accent }: { element: ElementKey; accent: string }) {
  const aim = ELEMENT_AIM[element]
  return <path d={bandPath(CORE + 2, ZIWEI_OUT + 8, aim - 16, aim + 16, 2)} fill={accent} opacity={0.1} />
}

function SectorRays({ element, accent }: { element: ElementKey; accent: string }) {
  const aim = ELEMENT_AIM[element]
  const inner = polar(CORE + 2, aim)
  const edge0 = polarJ(ZIWEI_OUT + 10, aim - 17, 4)
  const edge1 = polarJ(ZIWEI_OUT + 10, aim + 17, 5)
  return (
    <g>
      <line x1={inner.x} y1={inner.y} x2={edge0.x} y2={edge0.y} stroke={accent} strokeWidth={SW.med} />
      <line x1={inner.x} y1={inner.y} x2={edge1.x} y2={edge1.y} stroke={accent} strokeWidth={SW.med} />
    </g>
  )
}

const FUDAN_BASE_SIZE = 380
const FUDAN_EXORCISM_SIZE = 460

function fudanSizeFor(glyph: string): number {
  return glyph === '鎭' ? FUDAN_EXORCISM_SIZE : FUDAN_BASE_SIZE
}

function FudanMark({
  glyph,
  accent,
  x = CX,
  y = 370,
  height,
}: {
  glyph: string
  accent: string
  x?: number
  y?: number
  height?: number
}) {
  const size = height ?? fudanSizeFor(glyph)
  const chars = [...glyph]
  const maxH = Math.max(...chars.map((ch) => talismanGlyph(ch).bbox.h))
  const scale = size / maxH
  const total = chars.reduce((sum, ch) => sum + talismanGlyph(ch).advance * scale, 0)
  const padX = size * 0.18
  const w = total + padX * 2
  const h = size + size * 0.22
  let cursor = -total / 2
  return (
    <g data-fudan={glyph} data-fudan-size={String(size)} transform={`translate(${x} ${y})`}>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill="none"
        stroke={accent}
        strokeWidth={SW.hair}
      />
      <g fill={accent} stroke={accent} strokeLinecap="square" strokeLinejoin="miter" fillRule="evenodd">
        {chars.map((ch, i) => {
          const path = talismanGlyph(ch)
          const cx = path.bbox.x + path.bbox.w / 2
          const cy = path.bbox.y + path.bbox.h / 2
          const node = (
            <g key={`${ch}-${i}`} transform={`translate(${cursor + (path.advance * scale) / 2} 0) scale(${scale}) translate(${-cx} ${-cy})`}>
              <path data-hanja={ch} data-hanja-codepoint={path.codepoint} d={path.d} strokeWidth={TALISMAN_GLYPH_UNITS * 0.028} />
            </g>
          )
          cursor += path.advance * scale
          return node
        })}
      </g>
    </g>
  )
}

function Spine({ accent }: { accent: string }) {
  const gap = CORE + 8
  return (
    <g fill={accent} stroke={accent} strokeLinecap="butt" data-spine="kept">
      <rect x={CX - 3} y={CY - ZIWEI_IN + 8} width={6} height={ZIWEI_IN - CORE - 16} />
      <rect x={CX - 3} y={CY + gap} width={6} height={ZIWEI_IN - CORE - 16} />
    </g>
  )
}

function TallFrame() {
  return (
    <g data-tall-frame="true" fill="none">
      <rect x={40} y={40} width={MASTER_W - 80} height={MASTER_H - 80} stroke={INK.hair} strokeWidth={SW.hair} />
      <rect x={52} y={52} width={MASTER_W - 104} height={MASTER_H - 104} stroke={INK.base} strokeWidth={SW.hair} />
      {(
        [
          [52, 52, 1, 1],
          [MASTER_W - 52, 52, -1, 1],
          [52, MASTER_H - 52, 1, -1],
          [MASTER_W - 52, MASTER_H - 52, -1, -1],
        ] as const
      ).map(([x, y, dx, dy], i) => (
        <g key={i} stroke={INK.strong} strokeWidth={SW.med}>
          <line x1={x} y1={y} x2={x + dx * 28} y2={y} />
          <line x1={x} y1={y} x2={x} y2={y + dy * 28} />
        </g>
      ))}
    </g>
  )
}

function TallTop({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const fudan = spec.fudanGlyph ?? (spec.purposeWealth ? '財' : null)
  if (fudan) {
    return (
      <g data-zone="top">
        <FudanMark glyph={fudan} accent={accent} x={CIRCLE_CX} y={370} />
      </g>
    )
  }
  if (!spec.element) return <g data-zone="top" />
  return (
    <g data-zone="top">
      <HanjaGlyph x={CIRCLE_CX} y={280} size={300} fill={accent}>
        {ELEMENT_META[spec.element].hanja}
      </HanjaGlyph>
      <PhysicsGlyph element={spec.element} accent={accent} x={CIRCLE_CX} y={520} height={90} />
    </g>
  )
}

const SEAL_VERMILION = '#c23b22'
const SEAL_FIRE = '#8f1d14'
const SEAL_CREAM = '#f3ead8'

function sealInk(element: TalismanSpec['element']): string {
  return element === 'fire' ? SEAL_FIRE : SEAL_VERMILION
}

/** Clean rounded square; edge wander stays ≤ 3. */
function stampedSquare(size: number): string {
  const h = size / 2
  const r = 6
  const steps = 8
  const parts: string[] = []
  const sides = [
    { x0: -h + r, y0: -h, x1: h - r, y1: -h, nx: 0, ny: -1, phase: 0.4 },
    { x0: h, y0: -h + r, x1: h, y1: h - r, nx: 1, ny: 0, phase: 1.1 },
    { x0: h - r, y0: h, x1: -h + r, y1: h, nx: 0, ny: 1, phase: 2.2 },
    { x0: -h, y0: h - r, x1: -h, y1: -h + r, nx: -1, ny: 0, phase: 3.3 },
  ] as const
  const corners = [
    { cx: h - r, cy: -h + r, a0: -90, a1: 0 },
    { cx: h - r, cy: h - r, a0: 0, a1: 90 },
    { cx: -h + r, cy: h - r, a0: 90, a1: 180 },
    { cx: -h + r, cy: -h + r, a0: 180, a1: 270 },
  ] as const
  sides.forEach((side, s) => {
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      const wob = Math.max(-3, Math.min(3, 2.2 * Math.sin(t * Math.PI * 2 + side.phase)))
      const x = side.x0 + (side.x1 - side.x0) * t + side.nx * wob
      const y = side.y0 + (side.y1 - side.y0) * t + side.ny * wob
      parts.push(`${s === 0 && i === 0 ? 'M' : 'L'}${round(x)},${round(y)}`)
    }
    const c = corners[s]!
    for (let i = 1; i <= 4; i += 1) {
      const a = ((c.a0 + ((c.a1 - c.a0) * i) / 4) * Math.PI) / 180
      parts.push(`L${round(c.cx + r * Math.cos(a))},${round(c.cy + r * Math.sin(a))}`)
    }
  })
  return `${parts.join('')}Z`
}

function SealStamp({
  spec,
  x,
  y,
  size = 200,
}: {
  spec: TalismanSpec
  x: number
  y: number
  size?: number
}) {
  const ink = sealInk(spec.element)
  const serial = spec.serial ?? ''
  const runeScale = (size * 0.36) / 80
  const serialSize = Math.max(26, size * 0.14)
  return (
    <g data-seal-stamp="true" data-seal-ink={ink} data-seal-edge="square" transform={`translate(${x} ${y})`}>
      <path d={stampedSquare(size)} fill={ink} stroke="none" data-seal-face="true" />
      <g transform={`translate(0 ${-size * 0.1}) scale(${runeScale})`} data-seal-cutout="bindrune">
        <BindruneSigil stones={spec.bindruneRunes} x={0} y={0} accent={SEAL_CREAM} />
      </g>
      <text
        x={0}
        y={round(size * 0.34)}
        textAnchor="middle"
        fill={SEAL_CREAM}
        fontSize={serialSize}
        fontFamily="ui-monospace, monospace"
        letterSpacing="1.2"
        data-seal-serial="true"
      >
        {serial}
      </text>
    </g>
  )
}

function TallBottom({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const serial = spec.serial ? `No. ${spec.serial}` : ''
  return (
    <g data-zone="bottom">
      <g transform="translate(500 1688) scale(3.25)" data-bindrune-slot="true">
        <BindruneSigil stones={spec.bindruneRunes} x={0} y={0} accent={accent} />
      </g>
      <SealStamp spec={spec} x={CIRCLE_CX} y={1936} size={200} />
      <text
        x={CIRCLE_CX}
        y={2048}
        textAnchor="middle"
        fill={INK.hair}
        fontSize="32"
        fontFamily="ui-monospace, monospace"
        letterSpacing="3"
        data-serial="true"
      >
        {serial}
      </text>
    </g>
  )
}

function circleTransform(): string {
  return `translate(${CIRCLE_CX} ${CIRCLE_CY}) scale(${CIRCLE_SCALE}) translate(${-CX} ${-CY})`
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
  const hot = Boolean(spec.purposeFilter?.saju)
  return (
    <g data-purpose-hit={hot ? 'saju' : undefined}>
      {spec.sajuChung.map(([a, b]) => (
        <path key={`c${a}-${b}`} d={bow(pts[a]!, pts[b]!)} fill="none" stroke={INK.base} strokeWidth={SW.hair} />
      ))}
      {spec.sajuHap.map(([a, b]) => (
        <path key={`h${a}-${b}`} d={bow(pts[a]!, pts[b]!)} fill="none" stroke={accent} strokeWidth={SW.med} />
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
              <rect x={p.x - 20} y={p.y - 20} width={40} height={40} fill={GROUND} stroke={accent} strokeWidth={SW.med} />
            ) : (
              <circle cx={p.x} cy={p.y} r={20} fill={GROUND} stroke={hot ? INK.base : INK.hair} strokeWidth={hot ? SW.med : SW.hair} />
            )}
            <g opacity={hot ? 0.85 : 0.45}>
              <HanjaGlyph x={p.x} y={p.y} size={19.2} fill={ch.isDayMaster ? accent : INK.strong} dy={7}>
                {ch.hanja}
              </HanjaGlyph>
            </g>
          </g>
        )
      })}
    </g>
  )
}

function HexagramStack({ lines, hot }: { lines: readonly boolean[]; hot?: boolean }) {
  const x = CX - 118
  const y0 = CY - 52
  const weight = hot ? 3.2 : SW.med
  return (
    <g stroke={INK.strong} strokeLinecap="butt" data-purpose-hit={hot ? 'iching' : undefined}>
      {lines.map((yang, i) => {
        const y = y0 + i * 14
        if (yang) return <line key={i} x1={x - 28} y1={y} x2={x + 28} y2={y} strokeWidth={weight} />
        return (
          <g key={i}>
            <line x1={x - 28} y1={y} x2={x - 5} y2={y} strokeWidth={weight} />
            <line x1={x + 5} y1={y} x2={x + 28} y2={y} strokeWidth={weight} />
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

const LUOSHU_ELEMENT: Record<(typeof LUOSHU)[number], ElementKey> = {
  1: 'water',
  2: 'fire',
  3: 'wood',
  4: 'metal',
  5: 'earth',
  6: 'water',
  7: 'fire',
  8: 'wood',
  9: 'metal',
}

function Luoshu({ spec, accent }: { spec: TalismanSpec; accent: string }) {
  const sealed = spec.luoshuSealed
  const secondary = spec.secondaryElement ?? null
  const starHot = Boolean(spec.purposeFilter?.ninestar)
  const half = LUOSHU_HALF
  const cell = round((half * 2) / 3)
  const originX = round(CX - half)
  const originY = round(CY - half)
  const earthHit = secondary === 'earth'
  return (
    <g>
      <rect
        x={originX}
        y={originY}
        width={half * 2}
        height={half * 2}
        fill="none"
        stroke={earthHit || starHot ? INK.strong : INK.faint}
        strokeWidth={earthHit || starHot ? SW.med : SW.hair}
        data-secondary-sector={earthHit ? 'earth' : undefined}
        data-purpose-hit={starHot ? 'ninestar' : undefined}
      />
      {LUOSHU.map((palace, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = originX + col * cell
        const y = originY + row * cell
        const cx = x + cell / 2
        const cy = y + cell / 2
        const covered = sealed.includes(palace)
        const hit = secondary != null && LUOSHU_ELEMENT[palace] === secondary && palace !== 5
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
          <g key={palace} data-secondary-sector={hit ? palace : undefined}>
            <rect
              x={x}
              y={y}
              width={cell}
              height={cell}
              fill="none"
              stroke={hit || starHot ? INK.strong : INK.faint}
              strokeWidth={hit || starHot ? SW.med : SW.hair}
            />
            {covered ? null : (
              <text
                x={cx}
                y={cy + 7}
                textAnchor="middle"
                fill={hit ? INK.strong : INK.hair}
                fontSize="32"
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

function TarotMark({
  mark,
  x,
  y,
  reversed,
}: {
  mark: 'wands' | 'cups' | 'swords' | 'pentacles'
  x: number
  y: number
  reversed?: boolean
}) {
  const turn = reversed ? ' rotate(180)' : ''
  return (
    <g transform={`translate(${x} ${y})${turn}`} stroke={INK.strong} fill="none" strokeWidth={1.8} strokeLinecap="butt">
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
    <g transform={`translate(${x} ${y})`} stroke={INK.strong} fill="none" strokeLinecap="butt" data-mark="nawal">
      <rect x="-40" y="-48" width="80" height="96" rx="6" strokeWidth={SW.med} />
      {Array.from({ length: bars }, (_, i) => (
        <rect key={`b${i}`} x="-24" y={-38 + i * 12} width="48" height="9" fill={INK.strong} stroke="none" />
      ))}
      {Array.from({ length: dots }, (_, i) => (
        <circle key={`d${i}`} cx={-16 + i * 10} cy={-38 + bars * 12 + 12} r="5" fill={INK.strong} stroke="none" />
      ))}
      <g transform={`translate(-21 ${4 + (bars > 0 ? 4 : 0)}) scale(1.75)`} color={INK.strong}>
        <NawalGlyph nawal={nawal} />
      </g>
      <text
        x="0"
        y="38"
        textAnchor="middle"
        fill={INK.base}
        stroke="none"
        fontSize="32"
        fontFamily="ui-monospace, monospace"
      >
        {tone} · {nawal}
      </text>
    </g>
  )
}

function MiddleScripts({ spec }: { spec: TalismanSpec }) {
  const reversed = new Set(spec.tarotReversedSuits ?? [])
  const suits = (spec.tarotSuits ?? ['wands', 'cups', 'swords', 'pentacles']).map((mark) => ({
    mark,
    a: mark === 'wands' ? 128 : mark === 'cups' ? 52 : mark === 'swords' ? -128 : -52,
    reversed: reversed.has(mark),
  }))
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
              fontSize="32"
              fontFamily="ui-monospace, monospace"
            >
              {digit}
            </text>
          </g>
        )
      })}
      {(spec.numerologyMissing ?? []).map((digit, i) => {
        const r = 236
        const rot = 48 + i * 22
        const label = polar(r, rot)
        const sides = Math.max(3, Math.min(digit, 9))
        return (
          <g key={`miss-${digit}`} data-numerology-missing={digit}>
            {digit <= 2 ? (
              <circle cx={label.x} cy={label.y} r={digit === 1 ? 10 : 14} fill="none" stroke={INK.base} strokeWidth={SW.hair} strokeDasharray="3 4" />
            ) : (
              <polygon
                points={polyPoints(sides, r, rot)}
                fill="none"
                stroke={INK.base}
                strokeWidth={SW.hair}
                strokeDasharray="3 4"
              />
            )}
            <text
              x={label.x}
              y={label.y + 4}
              textAnchor="middle"
              fill={INK.base}
              fontSize="32"
              fontFamily="ui-monospace, monospace"
            >
              {digit}
            </text>
          </g>
        )
      })}
      {suits.map((s) => {
        const p = polar(SCRIPT_R, s.a)
        return <TarotMark key={s.mark} mark={s.mark} x={p.x} y={p.y} reversed={s.reversed} />
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
      <polyline points={arcPoly(inner, 14, 172, 6)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
      <polyline points={arcPoly(inner, 196, 348, 6)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
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

function diamondPoints(size: number): string {
  const h = size / 2
  return `0,${-h} ${h},0 0,${h} ${-h},0`
}

/** 1–3 filled diamonds along the palace arc. Never a tick-over-dot. */
function PalaceIndexMark({
  index,
  x,
  y,
  bearing,
}: {
  index: number
  x: number
  y: number
  bearing: number
}) {
  const count = (index % 3) + 1
  const size = 30
  const r = Math.hypot(x - CX, y - CY)
  return (
    <g data-palace-mark={index} data-palace-diamonds={count} fill={INK.strong} stroke="none">
      {Array.from({ length: count }, (_, i) => {
        const p = polar(r, bearing + (i - (count - 1) / 2) * 7)
        return <polygon key={i} data-palace-diamond="true" points={diamondPoints(size)} transform={`translate(${p.x} ${p.y})`} />
      })}
    </g>
  )
}

function palaceFillOpacity(brightness: PalaceMark['brightness'] | undefined, emphasised = false): number {
  const base = brightness === 'solid' ? 0.24 : brightness === 'faint' ? 0.045 : 0.11
  return emphasised ? Math.min(0.42, base + 0.18) : base
}

function PalaceHatch({
  d,
  clipId,
  weight,
}: {
  d: string
  clipId: string
  weight: 1 | 2
}) {
  const step = weight === 1 ? 20 : 11
  const lines: ReactNode[] = []
  for (let x = -400; x < 1600; x += step) {
    lines.push(
      <line
        key={x}
        x1={x}
        y1={-400}
        x2={x}
        y2={1400}
        stroke={weight === 1 ? INK.hair : INK.base}
        strokeWidth={weight === 1 ? SW.hair : SW.med}
      />,
    )
  }
  return (
    <g>
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <g transform={`rotate(34 ${CX} ${CY})`}>{lines}</g>
      </g>
    </g>
  )
}

function ZiweiRing({
  palaces,
  accent,
  uid,
  emphasise,
}: {
  palaces: TalismanSpec['palaces']
  accent: string
  uid: string
  emphasise?: string | null
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
        const hot = emphasise != null && palace.name === emphasise
        if (palace.empty && !hot) return null
        if (palace.sealed) {
          return (
            <g key={palace.name} data-purpose-hit={hot ? 'ziwei' : undefined}>
              <polyline
                points={arcPoly(rOut + 4, a0 + 2, a1 - 2, i)}
                fill="none"
                stroke={accent}
                strokeWidth={hot ? SW.med : SW.hair}
              />
              <polyline
                points={arcPoly(ZIWEI_IN, a0 + 2, a1 - 2, i)}
                fill="none"
                stroke={accent}
                strokeWidth={hot ? SW.med : SW.hair}
              />
              <SealKnot x={mid.x} y={mid.y} accent={accent} scale={1} />
            </g>
          )
        }
        const band = bandPath(ZIWEI_IN, rOut, a0 + 1.2, a1 - 1.2, i)
        const malefic = palace.maleficCount ?? 0
        const hatchWeight: 1 | 2 | 0 = malefic <= 0 ? 0 : malefic === 1 ? 1 : 2
        return (
          <g key={palace.name} data-purpose-hit={hot ? 'ziwei' : undefined}>
            <path d={band} fill={INK.strong} opacity={palaceFillOpacity(palace.brightness, hot)} />
            {hatchWeight ? (
              <PalaceHatch d={band} clipId={`${uid}-hatch-${i}`} weight={hatchWeight} />
            ) : null}
            <polyline
              points={arcPoly(rOut, a0 + 1.2, a1 - 1.2, i)}
              fill="none"
              stroke={hot ? INK.strong : INK.hair}
              strokeWidth={hot ? SW.med : SW.hair}
            />
            <PalaceIndexMark index={i} x={mid.x} y={mid.y} bearing={a0 + 15} />
          </g>
        )
      })}
    </g>
  )
}

/** 化忌 dot and 대한 tick sit above TextureCuts so a 空宮 gap does not erase them. */
function ZiweiSignals({ palaces }: { palaces: TalismanSpec['palaces'] }) {
  if (palaces == null) return null
  return (
    <g>
      {palaces.map((palace, i) => {
        const mid = -90 + i * 30 + 15
        const marks: ReactNode[] = []
        if (palace.daXian) {
          const a = palace.huaJi ? mid - 5 : mid
          const p = polar(ZIWEI_IN + 8, a)
          marks.push(
            <polygon
              key={`daxian-${palace.name}`}
              data-daxian="true"
              points={diamondPoints(22)}
              transform={`translate(${p.x} ${p.y})`}
              fill={INK.strong}
              stroke="none"
            />,
          )
        }
        if (palace.huaJi) {
          const a = palace.daXian ? mid + 6 : mid
          const p = polar(ZIWEI_IN + 11, a)
          marks.push(<circle key={`huaji-${palace.name}`} cx={p.x} cy={p.y} r={16} fill={INK.strong} />)
        }
        if (marks.length === 0) return null
        return <g key={`sig-${palace.name}`}>{marks}</g>
      })}
    </g>
  )
}

function HyungNotches({ spec }: { spec: TalismanSpec }) {
  const hot = Boolean(spec.purposeFilter?.name)
  return (
    <g data-purpose-hit={hot ? 'name' : undefined}>
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
              stroke={hot ? INK.strong : INK.hair}
              strokeWidth={hot ? SW.med : SW.hair}
            />
            <SealKnot x={seat.x} y={seat.y} accent={INK.strong} scale={1} />
          </g>
        )
      })}
    </g>
  )
}

function ZodiacMark({ id, x, y }: { id: (typeof TALISMAN_ZODIAC_IDS)[number]; x: number; y: number }) {
  const glyph = talismanZodiac(id)
  const size = 36
  const scale = size / Math.max(glyph.bbox.h, glyph.bbox.w)
  const cx = glyph.bbox.x + glyph.bbox.w / 2
  const cy = glyph.bbox.y + glyph.bbox.h / 2
  return (
    <g data-zodiac={id} data-zodiac-codepoint={glyph.codepoint} transform={`translate(${x} ${y}) scale(${scale}) translate(${-cx} ${-cy})`}>
      <path d={glyph.d} fill={INK.base} stroke="none" fillRule="evenodd" />
    </g>
  )
}

function PlanetGlyph({ id, x, y }: { id: string; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(3.4)`} stroke={INK.base} fill="none" strokeWidth={1.2} strokeLinecap="butt">
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
      {TALISMAN_ZODIAC_IDS.map((id, i) => {
        const mid = i * 30 + 15
        const p = polarJ(SIGN_R, 180 - mid, i)
        return <ZodiacMark key={id} id={id} x={p.x} y={p.y} />
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
          strokeWidth={SW.med}
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
  const identity = prismHex(spec.prismColors?.identity)
  const need = prismHex(spec.prismColors?.need)
  const impulse = prismHex(spec.prismColors?.impulse)
  const painted = dent != null && identity != null && need != null && impulse != null
  const hot = Boolean(spec.purposeFilter?.prism)
  const hex: string[] = []
  let dentPt: Pt | null = null
  if (painted) {
    for (let i = 0; i < 6; i += 1) {
      const r = i === dent ? 418 : 448 + (i % 2 === 0 ? 6 : -4)
      const p = polarJ(r, -90 + i * 60, i)
      hex.push(`${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
      if (i === dent) dentPt = p
    }
  }
  return (
    <g opacity={hot ? 0.55 : 0.28} data-purpose-hit={hot ? 'prism' : undefined}>
      {painted ? (
        <>
          <path
            d={`${hex.join(' ')} Z`}
            fill={identity}
            fillOpacity={0.22}
            stroke="none"
            data-prism="identity"
          />
          <path
            d={`${hex.join(' ')} Z`}
            fill="none"
            stroke={need}
            strokeWidth={SW.hair}
            data-prism="need"
          />
          {dentPt ? (
            <circle
              cx={dentPt.x}
              cy={dentPt.y}
              r="16"
              fill={impulse}
              stroke="none"
              data-prism="impulse"
            />
          ) : null}
        </>
      ) : (
        <circle
          cx={CX}
          cy={CY}
          r={448}
          fill="none"
          stroke={INK.faint}
          strokeWidth={SW.hair}
          strokeDasharray="2 6"
          data-prism="blank"
        />
      )}
      <polyline points={arcPoly(458, 12, 198, 8)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
      <polyline points={arcPoly(458, 224, 352, 8)} fill="none" stroke={INK.hair} strokeWidth={SW.hair} />
      {(() => {
        const a = 90 - spec.sukuyouIndex * 13
        const p0 = polar(454, a)
        const p1 = polar(468, a)
        return <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={INK.strong} strokeWidth={SW.hair} />
      })()}
      <polyline points={arcPoly(470, -20, 140, 9)} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
      <polyline points={arcPoly(470, 168, 310, 9)} fill="none" stroke={INK.faint} strokeWidth={SW.hair} />
    </g>
  )
}

function luoshuCell(index: number): { x: number; y: number; w: number; cx: number; cy: number } {
  const half = LUOSHU_HALF
  const w = round((half * 2) / 3)
  const x = round(CX - half) + (index % 3) * w
  const y = round(CY - half) + Math.floor(index / 3) * w
  return { x, y, w, cx: x + w / 2, cy: y + w / 2 }
}

/** Value-removals cut through every layer in that sector, not only the owning ring. */
function TextureCuts({ spec }: { spec: TalismanSpec }) {
  const houseInner = SIGN_R - 26
  const houseOuter = ZIWEI_IN - 2
  const cutHouses = spec.housesMissing ?? spec.palaces == null
  return (
    <g>
      {cutHouses ? (
        <path
          fill={GROUND}
          fillRule="evenodd"
          d={`M ${CX - houseOuter} ${CY} a ${houseOuter} ${houseOuter} 0 1 0 ${houseOuter * 2} 0 a ${houseOuter} ${houseOuter} 0 1 0 ${-houseOuter * 2} 0 M ${CX - houseInner} ${CY} a ${houseInner} ${houseInner} 0 1 1 ${houseInner * 2} 0 a ${houseInner} ${houseInner} 0 1 1 ${-houseInner * 2} 0`}
        />
      ) : (
        (spec.palaces ?? []).map((palace, i) => {
          const a0 = -90 + i * 30
          if (palace.empty) {
            const left = polar(LATIN_R - 8, a0 + 1)
            const leftO = polar(ZIWEI_OUT + 18, a0 + 1)
            const right = polar(LATIN_R - 8, a0 + 29)
            const rightO = polar(ZIWEI_OUT + 18, a0 + 29)
            return (
              <g key={`empty-${palace.name}`}>
                <path d={bandPath(LATIN_R - 10, ZIWEI_OUT + 24, a0 + 0.4, a0 + 29.6, i)} fill={GROUND} />
                <line x1={left.x} y1={left.y} x2={leftO.x} y2={leftO.y} stroke={INK.hair} strokeWidth={SW.hair} />
                <line x1={right.x} y1={right.y} x2={rightO.x} y2={rightO.y} stroke={INK.hair} strokeWidth={SW.hair} />
              </g>
            )
          }
          if (palace.sealed) {
            return (
              <path
                key={`sealed-${palace.name}`}
                d={bandPath(LATIN_R - 10, ZIWEI_IN + 2, a0 + 0.4, a0 + 29.6, i)}
                fill={GROUND}
              />
            )
          }
          return null
        })
      )}
      {LUOSHU.map((palace, i) => {
        if (palace === 5 || !spec.luoshuSealed.includes(palace)) return null
        const c = luoshuCell(i)
        return <rect key={`luo-${palace}`} x={c.x} y={c.y} width={c.w} height={c.w} fill={GROUND} />
      })}
    </g>
  )
}

function LuoshuLocks({ sealed, accent }: { sealed: readonly number[]; accent: string }) {
  return (
    <g>
      {LUOSHU.map((palace, i) => {
        if (palace === 5 || !sealed.includes(palace)) return null
        const c = luoshuCell(i)
        return (
          <g key={`lock-${palace}`}>
            <rect x={c.x} y={c.y} width={c.w} height={c.w} fill="none" stroke={accent} strokeWidth={SW.hair} />
            <SealKnot x={c.cx} y={c.cy} accent={accent} scale={1.15} />
          </g>
        )
      })}
    </g>
  )
}

function SpreadLocks({ angles, accent }: { angles: readonly number[]; accent: string }) {
  return (
    <g>
      {angles.map((a, i) => {
        const p = polar(SCRIPT_R, a)
        return <SealKnot key={`spread-${i}`} x={p.x} y={p.y} accent={accent} scale={1} />
      })}
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
  const element = spec.element
  const accent = element ? ELEMENT_META[element].accent : INK.strong
  const [vx, vy, vw, vh] = frame.viewBox
  const tall = frame.layout === 'tall'
  return (
    <svg
      className="talisman-svg"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      role="img"
      aria-label={`${spec.title} ${frame.label}`}
      data-layout={frame.layout}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block', background: GROUND }}
    >
      <defs>
        <clipPath id={`${uid}-frame`}>
          <rect x={vx} y={vy} width={vw} height={vh} />
        </clipPath>
        {element ? (
          <>
            <filter id={`${uid}-glow-core`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={`${uid}-glow-mid`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={`${uid}-glow-soft`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="0.7" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </>
        ) : null}
      </defs>
      <rect x={vx} y={vy} width={vw} height={vh} fill={GROUND} />
      <g clipPath={`url(#${uid}-frame)`}>
        {tall ? <TallFrame /> : null}
        {tall ? <TallTop spec={spec} accent={accent} /> : null}
        <g data-zone="circle" transform={circleTransform()}>
          <circle cx={CX} cy={CY} r={500} fill="none" stroke={INK.hair} strokeWidth={SW.hair} data-circle="900" />
          <BleedGrid />
          <g transform={element ? leanTransform(element, spec.mode === 'drain') : undefined}>
            {element ? <ElementSector element={element} accent={accent} /> : null}
            <Luoshu spec={spec} accent={accent} />
            <MinorRim spec={spec} />
            {spec.planets.length > 0 ? (
              <AstroRing planets={spec.planets} ascendant={spec.ascendant} accent={accent} />
            ) : spec.palaces != null ? (
              <AstroRing planets={spec.planets} ascendant={spec.ascendant} accent={accent} />
            ) : null}
            {spec.palaces != null || spec.numerology.length > 0 ? <MiddleScripts spec={spec} /> : null}
            <IchingGaps emptySeats={spec.bokjangEmpty} />
            <HexagramStack lines={spec.ichingLines} hot={Boolean(spec.purposeFilter?.iching)} />
            <ZiweiRing palaces={spec.palaces} accent={accent} uid={uid} emphasise={spec.purposeFilter?.ziwei} />
            <SajuRing spec={spec} accent={accent} />
            <g filter={element ? `url(#${uid}-glow-mid)` : undefined}>
              <Spine accent={accent} />
            </g>
            <TextureCuts spec={spec} />
            <ZiweiSignals palaces={spec.palaces} />
            <LuoshuLocks sealed={spec.luoshuSealed} accent={accent} />
            <SpreadLocks angles={spec.spreadLocks ?? []} accent={accent} />
            <HyungNotches spec={spec} />
            <g filter={element ? `url(#${uid}-glow-core)` : undefined}>
              <Centre spec={spec} accent={accent} />
            </g>
            {element ? (
              <g filter={`url(#${uid}-glow-soft)`}>
                <SectorRays element={element} accent={accent} />
              </g>
            ) : null}
          </g>
        </g>
        {tall ? <TallBottom spec={spec} accent={accent} /> : (
          <SealStamp spec={spec} x={CIRCLE_CX + 330} y={CIRCLE_CY + 330} size={120} />
        )}
      </g>
    </svg>
  )
}
