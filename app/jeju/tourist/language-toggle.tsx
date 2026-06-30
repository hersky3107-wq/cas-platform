'use client'

import { useState } from 'react'
import { Globe, X } from 'lucide-react'
import { TOURIST_LANG_OPTIONS } from '@/lib/jeju/tourist-labels'
import { useTouristUi } from '@/components/jeju/useTouristUi'

/**
 * Always-visible language row — all 5 languages shown at once so foreign
 * visitors immediately see and tap their language without hunting a dropdown.
 * Wraps naturally on narrow screens; active locale gets a filled pill.
 *
 * For non-Korean locales, a small dismissible hint (in the selected language)
 * sits directly under the row, suggesting the browser's own translate feature
 * for fullest accuracy. Dismissal is in-memory and per-locale, so switching to
 * another language shows the hint again.
 */
export function LanguageToggle() {
  const { locale, t, setLocale } = useTouristUi()
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  const showHint = locale !== 'ko' && t.browserHint.trim() !== '' && dismissedFor !== locale

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Globe
          size={13}
          strokeWidth={2.5}
          className="shrink-0 text-[#00A8B5]"
          aria-hidden
        />
        {TOURIST_LANG_OPTIONS.map((opt) => {
          const active = opt.code === locale
          return (
            <button
              key={opt.code}
              type="button"
              onClick={() => setLocale(opt.code)}
              aria-pressed={active}
              className={[
                'rounded-full px-2.5 py-1 text-[11px] font-bold leading-none transition-colors',
                active
                  ? 'bg-[#00A8B5] text-white shadow-sm'
                  : 'bg-white/80 text-[#00707A] ring-1 ring-[#00A8B5]/30 hover:bg-white hover:ring-[#00A8B5]/60',
              ].join(' ')}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {showHint && (
        <div className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[#5A7176]">
          <span className="flex-1">{t.browserHint}</span>
          <button
            type="button"
            onClick={() => setDismissedFor(locale)}
            aria-label="Dismiss"
            className="shrink-0 rounded-full p-0.5 text-[#8AA0A4] transition-colors hover:bg-black/5 hover:text-[#5A7176]"
          >
            <X size={12} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
