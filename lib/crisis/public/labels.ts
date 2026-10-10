import { getCrisisUiPack } from '../i18n/dictionary'

export function noveltyBadge(novelty: string | undefined, locale: 'ko' | 'en' = 'ko'): string | null {
  const t = getCrisisUiPack(locale)
  if (novelty === 'only_us') return t.onlyUs
  if (novelty === 'also_seen_elsewhere') return t.alsoSeenElsewhere
  return null
}

export function languageLabel(code: string): string {
  const labels: Record<string, string> = {
    ko: '한국어',
    en: 'English',
    ja: '日本語',
    zh: '中文',
    si: 'සිංහල',
    ta: 'தமிழ்',
    hi: 'हिन्दी',
    ar: 'العربية',
    fr: 'Français',
    es: 'Español',
    pt: 'Português',
    ru: 'Русский',
    de: 'Deutsch',
    bn: 'বাংলা',
    te: 'తెలుగు',
  }
  return labels[code] ?? code
}
