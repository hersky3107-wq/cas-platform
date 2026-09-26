import { TALISMAN_FRAMES, type FrameSpec } from '@/lib/oracle/talisman/variants'

export const TALISMAN_PNG_FORMATS = ['phone', 'wallet', 'square', 'desktop'] as const
export type TalismanPngFormat = (typeof TALISMAN_PNG_FORMATS)[number]

const MM_PER_IN = 25.4
const WALLET_DPI = 300
const WALLET_TRIM_W_MM = 54
const WALLET_TRIM_H_MM = 85.6
const WALLET_BLEED_MM = 3

function mmToPx(mm: number): number {
  return Math.round((mm / MM_PER_IN) * WALLET_DPI)
}

export const WALLET_TRIM_PX = {
  width: mmToPx(WALLET_TRIM_W_MM),
  height: mmToPx(WALLET_TRIM_H_MM),
} as const

export const WALLET_BLEED_PX = mmToPx(WALLET_BLEED_MM)

export type TalismanPngSize = {
  width: number
  height: number
  frameId: FrameSpec['id']
  bleed: number
}

export const TALISMAN_PNG_SIZE: Record<TalismanPngFormat, TalismanPngSize> = {
  phone: { width: 1290, height: 2796, frameId: 'phone', bleed: 0 },
  wallet: {
    width: WALLET_TRIM_PX.width + WALLET_BLEED_PX * 2,
    height: WALLET_TRIM_PX.height + WALLET_BLEED_PX * 2,
    frameId: 'wallet',
    bleed: WALLET_BLEED_PX,
  },
  square: { width: 1080, height: 1080, frameId: 'square', bleed: 0 },
  desktop: { width: 1920, height: 1080, frameId: 'desktop', bleed: 0 },
}

export function parseTalismanPngFormat(raw: string | null): TalismanPngFormat | null {
  if (!raw) return null
  return (TALISMAN_PNG_FORMATS as readonly string[]).includes(raw) ? (raw as TalismanPngFormat) : null
}

export function frameForPng(format: TalismanPngFormat): FrameSpec {
  const id = TALISMAN_PNG_SIZE[format].frameId
  const frame = TALISMAN_FRAMES.find((item) => item.id === id)
  if (!frame) throw new Error(`missing talisman frame ${id}`)
  return frame
}
