'use client'

import { CRISIS_LOCALE_NAMES, CRISIS_SELECTABLE_LOCALES, type CrisisLocale } from '@/lib/crisis/i18n/locales'

export function CrisisLanguageToggle({
  locale,
  onChange,
  label,
}: {
  locale: CrisisLocale
  onChange: (locale: CrisisLocale) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-400">
      <span className="sr-only">{label}</span>
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value as CrisisLocale)}
        className="rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-xs font-medium text-white"
        aria-label={label}
      >
        {CRISIS_SELECTABLE_LOCALES.map((code) => (
          <option key={code} value={code}>
            {CRISIS_LOCALE_NAMES[code] ?? code}
          </option>
        ))}
      </select>
    </label>
  )
}
