/**
 * Module visibility control.
 * Add a module key + array of locales where it should be hidden.
 * This is the single source of truth for all module visibility rules.
 *
 * To hide a module for a locale, add an entry:
 * moduleName: ['ar', 'ko']  ← hidden for Arabic and Korean users
 */
export const MODULE_VISIBILITY: Record<string, string[]> = {
  oracle: ['ar'],   // Oracle hidden for Arabic (Islamic cultural sensitivity)
}

/**
 * Returns true if the module should be hidden for the given locale.
 * Case-insensitive on moduleKey.
 */
export function isModuleHidden(moduleKey: string, locale: string): boolean {
  const hiddenFor = MODULE_VISIBILITY[moduleKey.toLowerCase()]
  if (!hiddenFor || hiddenFor.length === 0) return false
  return hiddenFor.includes(locale)
}

export function getVisibleModules(
  allModules: string[],
  locale: string
): string[] {
  return allModules.filter(m => !isModuleHidden(m, locale))
}
