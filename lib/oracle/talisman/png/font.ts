import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const FROM_MODULE = resolve(DIR, '../fonts/NotoSans-Regular.ttf')
const FROM_CWD = resolve(process.cwd(), 'lib/oracle/talisman/fonts/NotoSans-Regular.ttf')
export const TALISMAN_PNG_FONT_PATH = existsSync(FROM_MODULE) ? FROM_MODULE : FROM_CWD
export const TALISMAN_PNG_FONT_FAMILY = 'Noto Sans'
export const TALISMAN_PNG_FONT_LICENCE = 'SIL Open Font License, Version 1.1'

let cached: Buffer | null = null

export function talismanPngFontBytes(): Buffer {
  cached ??= readFileSync(TALISMAN_PNG_FONT_PATH)
  return cached
}
