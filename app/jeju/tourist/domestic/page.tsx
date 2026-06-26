'use client'

import Link from 'next/link'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

const CATEGORIES = [
  { id: 'spots',    icon: '🍊', label: '가볼 곳',      href: '#' },
  { id: 'food',     icon: '🍜', label: '맛집',          href: '#' },
  { id: 'stay',     icon: '🏨', label: '숙소',          href: '#' },
  { id: 'car',      icon: '🚗', label: '교통·렌터카',   href: '#' },
  { id: 'weather',  icon: '🌤', label: '날씨',          href: '#' },
  { id: 'events',   icon: '🎫', label: '축제·행사',     href: '#' },
] as const

export default function JejuTouristDomesticPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="tourist"
      title={t.domesticTitle}
      tagline="제주를 더 즐겁게"
      backHref="/jeju/tourist"
      backLabel={t.backToTourist}
    >
      <div className="grid grid-cols-2 gap-[var(--jeju-gap)] sm:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            href={cat.href}
            className="group flex flex-col items-center gap-3 rounded-2xl border border-jeju-border bg-jeju-tile-bg p-5 text-center shadow-[var(--jeju-shadow)] transition hover:border-jeju-accent hover:bg-jeju-tile-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jeju-accent"
          >
            <span className="text-4xl leading-none" aria-hidden>{cat.icon}</span>
            <span className="font-bold leading-tight text-jeju-fg text-sm sm:text-base group-hover:text-jeju-accent">
              {cat.label}
            </span>
            <span className="rounded-full border border-jeju-border px-2 py-0.5 text-[10px] text-jeju-fg-muted">
              준비 중
            </span>
          </Link>
        ))}
      </div>
    </JejuThemeShell>
  )
}
