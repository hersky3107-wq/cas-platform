'use client'

import Link from 'next/link'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

const CATEGORIES = [
  { id: 'housing',     icon: '🏠', label: '주거·임대',   href: '#' },
  { id: 'jobs',        icon: '💼', label: '일자리·창업', href: '#' },
  { id: 'childcare',   icon: '🧒', label: '육아·교육',   href: '#' },
  { id: 'transport',   icon: '🚗', label: '교통·면허',   href: '#' },
  { id: 'health',      icon: '🩺', label: '건강·의료',   href: '#' },
  { id: 'admin',       icon: '📋', label: '민원·행정',   href: '#' },
] as const

export default function JejuResidentPracticalPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="resident"
      title={t.practicalTitle}
      tagline="생활 정보 · 실무 안내"
      backHref="/jeju"
      backLabel={t.backToJejuLobby}
    >
      <div className="grid grid-cols-2 gap-[var(--jeju-gap)] sm:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            href={cat.href}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-jeju-border bg-jeju-tile-bg p-6 text-center transition hover:border-jeju-accent hover:bg-jeju-tile-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-jeju-accent"
          >
            <span className="text-5xl leading-none" aria-hidden>{cat.icon}</span>
            <span className="font-bold leading-tight text-jeju-fg text-[length:var(--jeju-text-lg)] group-hover:text-jeju-accent">
              {cat.label}
            </span>
            <span className="rounded-full border border-jeju-border px-3 py-0.5 text-[length:var(--jeju-text-base)] text-jeju-fg-muted">
              준비 중
            </span>
          </Link>
        ))}
      </div>
    </JejuThemeShell>
  )
}
