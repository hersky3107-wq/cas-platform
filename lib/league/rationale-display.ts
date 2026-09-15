import type { CardModelPrediction } from './card-types'
import type { LeagueLocale } from './i18n/locales'

/** Same skip as `rationale-i18n.shouldTranslateLocale` — kept client-safe (no server-only). */
export function shouldTranslateRationaleLocale(locale: LeagueLocale): boolean {
  return locale !== 'en' && locale !== 'pt'
}

/**
 * Changes when a translatable snippet appears, disappears, or is rewritten.
 * Drives view-time translation on the stream/read path (not only first mount).
 */
export function rationaleSourceFingerprint(models: readonly CardModelPrediction[]): string {
  return models
    .filter((m) => (m.reasoning_snippet ?? '').trim().length > 0)
    .map((m) => {
      const text = m.reasoning_snippet!.trim()
      const id = m.prediction_id ?? m.model_id
      return `${id}:${text.length}:${text.slice(0, 24)}`
    })
    .sort()
    .join('\n')
}

/**
 * Cache rows are keyed by prediction_id. Live stream tiles may only have
 * model_id until the next GET /card — the rationales route also returns
 * byModelId so those tiles can swap without waiting for a remount.
 */
export function lookupTranslatedRationale(
  model: Pick<CardModelPrediction, 'prediction_id' | 'model_id'>,
  translations: Record<string, string> | null
): string | null {
  if (!translations) return null
  if (model.prediction_id) {
    const byId = translations[model.prediction_id]?.trim()
    if (byId) return byId
  }
  const byModel = translations[model.model_id]?.trim()
  return byModel || null
}

export function isRationaleTranslationPending(args: {
  locale: LeagueLocale
  original: string | null | undefined
  translated: string | null | undefined
  inFlight: boolean
}): boolean {
  if (!shouldTranslateRationaleLocale(args.locale)) return false
  if (!(args.original ?? '').trim()) return false
  if ((args.translated ?? '').trim()) return false
  return args.inFlight
}
