import { WIKI_PROJECT_ISO3, wikiProjectLang } from '../config/wiki-projects'

/** Languages the wiki-project map does not attach, but residents use. */
const EXTRA_LANG: Record<string, string[]> = {
  LKA: ['ta'],
  IND: ['ta', 'bn', 'te'],
  CAN: ['fr'],
  CHE: ['fr', 'de', 'it'],
  BEL: ['fr', 'nl', 'de'],
  ESP: ['ca', 'eu', 'gl'],
}

/** Local language codes for the region, always including English. */
export function localLanguages(iso3: string | null): string[] {
  const langs = new Set<string>(['en'])
  if (!iso3) return ['en']
  for (const [project, iso] of Object.entries(WIKI_PROJECT_ISO3)) {
    if (iso === iso3) langs.add(wikiProjectLang(project))
  }
  for (const extra of EXTRA_LANG[iso3] ?? []) langs.add(extra)
  return [...langs]
}
