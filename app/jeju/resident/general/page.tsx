'use client'

import Link from 'next/link'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

/** 일반 도민 mode — 10 live data chips (adult density). */
const CHIPS = [
  { emoji: '🎣', label: '오늘 조업', href: '/jeju/resident/fishing' },
  { emoji: '🌦', label: '날씨·재난', href: '/jeju/resident/weather' },
  { emoji: '🚌', label: '교통', href: '/jeju/resident/transport' },
  { emoji: '📰', label: '언론', href: '/jeju/resident/news' },
  { emoji: '💰', label: '물가·생활', href: '/jeju/resident/prices' },
  { emoji: '🎉', label: '축제·행사', href: '/jeju/resident/events' },
  { emoji: '♻️', label: '배출·환경', href: '/jeju/resident/environment' },
  { emoji: '🤖', label: '제주 AI', href: '/jeju/resident/jeju-chat' },
  { emoji: '🏥', label: '복지·행정', href: '/jeju/resident/welfare' },
  { emoji: '🌊', label: '해녀 물질안전', href: '/jeju/resident/haenyeo' },
] as const

export default function JejuResidentGeneralPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="resident"
      title={t.practicalTitle}
      tagline="제주 생활 · 실시간 정보"
      backHref="/jeju/resident"
      backLabel={t.backToResident}
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
