'use client'

import { LEAGUE_SELECTABLE_LOCALES, type LeagueLocale } from '@/lib/league/i18n/locales'

const LOCALE_DISPLAY_NAME: Record<LeagueLocale, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  'zh-TW': '繁體中文',
  fr: 'Français',
  ar: 'العربية',
  es: 'Español',
  pt: 'Português',
}

/**
 * Visible live override for the card's language (Layer A). Selecting a
 * locale here calls `setLocale`, which writes to the module-level override
 * store (`lib/league/i18n/locale-store.ts`) — it never touches jurisdiction/
 * visibility state (Layer B is untouched by this control).
 */
export function LanguageToggle({
  locale,
  onChange,
  label,
}: {
  locale: LeagueLocale
  onChange: (locale: LeagueLocale) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-league-fg-muted">
      <span className="sr-only">{label}</span>
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value as LeagueLocale)}
        className="rounded-full border border-league-border bg-league-bg-elevated px-2 py-1 text-[11px] font-medium text-league-fg"
        aria-label={label}
      >
        {LEAGUE_SELECTABLE_LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_DISPLAY_NAME[code]}
          </option>
        ))}
      </select>
    </label>
  )
}
