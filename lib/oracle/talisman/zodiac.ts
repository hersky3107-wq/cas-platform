import { TALISMAN_ZODIAC, type TalismanZodiacId, type TalismanZodiacPath } from './zodiac.generated'

export {
  TALISMAN_ZODIAC,
  TALISMAN_ZODIAC_FONT,
  TALISMAN_ZODIAC_IDS,
  TALISMAN_ZODIAC_LICENCE,
  TALISMAN_ZODIAC_UNITS,
  TALISMAN_ZODIAC_VERSION,
} from './zodiac.generated'
export type { TalismanZodiacId, TalismanZodiacPath }

export function talismanZodiac(id: TalismanZodiacId): TalismanZodiacPath {
  const glyph = TALISMAN_ZODIAC[id]
  if (!glyph) throw new Error(`missing talisman zodiac: ${id}`)
  return glyph
}
