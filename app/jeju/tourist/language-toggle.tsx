'use client'

import { Globe } from 'lucide-react'
import { TOURIST_LANG_OPTIONS } from '@/lib/jeju/tourist-labels'
import { useTouristUi } from '@/components/jeju/useTouristUi'

/**
 * Always-visible language row — all 5 languages shown at once so foreign
 * visitors immediately see and tap their language without hunting a dropdown.
 * Wraps naturally on narrow screens; active locale gets a filled pill.
 */
export function LanguageToggle() {
  const { locale, setLocale } = useTouristUi()

  return (
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
  )
}
