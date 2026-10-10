export function noveltyBadge(novelty: string | undefined): string | null {
  return novelty === 'only_us' ? '우리만 봤다' : null
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
