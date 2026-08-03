'use client'

import Link from 'next/link'
import { JejuThemeShell } from '@/components/gunpo/JejuThemeShell'
import { useJejuUi } from '@/components/gunpo/useJejuUi'

/**
 * Gunpo 시민(resident) mode hub — 6 live data chips. Cloned from
 * app/jeju/resident/general/page.tsx, trimmed from 10 chips down to the 6
 * ported for STEP3 (오늘 조업/해녀 물질안전/교통/물가 were intentionally not
 * ported — see STEP3 scope). 3-column grid preserved.
 *
 * 날씨·재난 and 환경 were merged into one 날씨·재난·환경 chip (7 → 6).
 */
const CHIPS = [
  { emoji: '🌦', label: '날씨·재난·환경', href: '/gunpo/resident/weather-env' },
  { emoji: '🚌', label: '교통', href: '/gunpo/resident/transport' },
  { emoji: '🏥', label: '복지·행정', href: '/gunpo/resident/welfare' },
  { emoji: '📰', label: '언론', href: '/gunpo/resident/news' },
  { emoji: '🤖', label: '군포 AI', href: '/gunpo/resident/chat' },
  { emoji: '🎉', label: '축제·행사', href: '/gunpo/resident/events' },
] as const

export default function GunpoResidentGeneralPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="resident"
      title="시민 생활 정보"
      tagline="군포 생활 · 실시간 정보"
      backHref="/gunpo/governance"
      backLabel={t.back}
    >
      <div className="grid grid-cols-2 gap-[var(--jeju-gap)] sm:grid-cols-3">
        {CHIPS.map((chip) => (
          <Link
            key={chip.href}
            href={chip.href}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-jeju-border bg-jeju-tile-bg p-5 text-center shadow-[var(--jeju-shadow)] transition hover:border-jeju-accent hover:bg-jeju-tile-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-jeju-accent"
          >
            <span className="text-4xl leading-none" aria-hidden>
              {chip.emoji}
            </span>
            <span className="font-bold leading-tight text-jeju-fg text-[length:var(--jeju-text-base)] group-hover:text-jeju-accent sm:text-lg">
              {chip.label}
            </span>
          </Link>
        ))}
      </div>
    </JejuThemeShell>
  )
}
