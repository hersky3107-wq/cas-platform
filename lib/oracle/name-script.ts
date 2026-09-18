/**
 * Name-script is primary for 성명학. The engine branches on locale:
 *   hangul  → locale 'ko'  → 한글 자모 획수 (원획법)
 *   hanja   → locale 'zh'  → 한자 강희자전 획수
 *   ja      → locale 'ja'  → 한자 강희자전 획수 (姓名判断)
 *   latin   → locale 'en'  → supported:false, 수비학 fallback
 *
 * Stored columns follow the script: Hangul in name_local, Hanja/Kanji in
 * name_hanja (and name_local for display), Latin in name_latin. Unused
 * columns are cleared so splitNameParts cannot pick a leftover script.
 */

export const NAME_SCRIPTS = ['hangul', 'hanja', 'ja', 'latin'] as const
export type NameScript = (typeof NAME_SCRIPTS)[number]

export type StoredNameColumns = {
  name_local: string | null
  name_hanja: string | null
  name_latin: string | null
}

export function isNameScript(value: string): value is NameScript {
  return (NAME_SCRIPTS as readonly string[]).includes(value)
}

/** Map a legacy `name_locale` tag (ko/ja/zh/en) onto the script enum. */
export function nameScriptFromLocaleTag(raw: string | null | undefined): NameScript | null {
  if (!raw) return null
  const tag = raw.trim().toLowerCase().replace('_', '-')
  if (!tag) return null
  if (tag === 'ko' || tag.startsWith('ko-')) return 'hangul'
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja'
  if (tag === 'zh' || tag.startsWith('zh')) return 'hanja'
  if (tag === 'en' || tag.startsWith('en-') || tag === 'latin') return 'latin'
  return null
}

export function nameEngineLocale(script: NameScript): string {
  switch (script) {
    case 'hangul':
      return 'ko'
    case 'hanja':
      return 'zh'
    case 'ja':
      return 'ja'
    case 'latin':
      return 'en'
  }
}

export function inferNameScriptFromText(text: string | null | undefined): NameScript | null {
  if (!text?.trim()) return null
  if (/[\uAC00-\uD7AF]/.test(text)) return 'hangul'
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja'
  if (/[\u4E00-\u9FFF]/.test(text)) return 'hanja'
  if (/[A-Za-z]/.test(text)) return 'latin'
  return null
}

export function inferNameScript(profile: {
  name_local?: string | null
  name_hanja?: string | null
  name_latin?: string | null
  derived?: Record<string, unknown> | null
}): NameScript {
  const stored = profile.derived?.name_script
  if (typeof stored === 'string' && isNameScript(stored)) return stored
  const fromHanja = inferNameScriptFromText(profile.name_hanja)
  if (fromHanja) return fromHanja === 'hangul' ? 'hanja' : fromHanja
  const fromLocal = inferNameScriptFromText(profile.name_local)
  if (fromLocal) return fromLocal
  const fromLatin = inferNameScriptFromText(profile.name_latin)
  if (fromLatin) return fromLatin
  return 'hangul'
}

export function composeStoredName(
  surname: string,
  given: string,
  script: NameScript,
): StoredNameColumns {
  const family = surname.trim()
  const personal = given.trim()
  if (!family || !personal) {
    return { name_local: null, name_hanja: null, name_latin: null }
  }
  if (script === 'latin') {
    return {
      name_local: null,
      name_hanja: null,
      name_latin: `${personal} ${family}`,
    }
  }
  const east = `${family}${personal}`
  if (script === 'hangul') {
    return { name_local: east, name_hanja: null, name_latin: null }
  }
  return { name_local: east, name_hanja: east, name_latin: null }
}

export function splitNameFields(
  script: NameScript,
  nameLocal: string | null | undefined,
  nameHanja: string | null | undefined,
  nameLatin: string | null | undefined,
): { surname: string; given: string } {
  if (script === 'latin') {
    const latin = nameLatin?.trim() ?? ''
    const parts = latin.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return { surname: parts[parts.length - 1]!, given: parts.slice(0, -1).join(' ') }
    }
    if (parts.length === 1) return { surname: '', given: parts[0]! }
    return { surname: '', given: '' }
  }
  const east =
    (script === 'hanja' || script === 'ja' ? nameHanja || nameLocal : nameLocal || nameHanja)?.trim() ??
    ''
  if (east.length >= 2) {
    return { surname: east.slice(0, 1), given: east.slice(1) }
  }
  if (east.length === 1) return { surname: east, given: '' }
  return { surname: '', given: '' }
}
