'use client'

import Link from 'next/link'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

// Fewer, bigger buttons — simplest language. No "약자" labeling on screen.
const CATEGORIES = [
  { id: 'health',   icon: '💊', label: '건강·병원',   href: '#' },
  { id: 'welfare',  icon: '💰', label: '복지·지원금', href: '#' },
  { id: 'contact',  icon: '📞', label: '전화·문의',   href: '#' },
  { id: 'bus',      icon: '🚌', label: '버스·이동',   href: '#' },
] as const

export default function JejuResidentAssistantPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="resident"
      title={t.assistantTitle}
      tagline="쉽고 간단한 안내"
      backHref="/jeju"
      backLabel={t.backToJejuLobby}
    >
      {/* 2-col grid — big tap targets, very large text, strong contrast */}
      <div className="grid grid-cols-2 gap-[var(--jeju-gap)]">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            href={cat.href}
            className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-jeju-border bg-jeju-tile-bg px-4 py-8 text-center transition hover:border-jeju-accent hover:bg-jeju-tile-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-jeju-accent"
          >
            <span className="text-6xl leading-none" aria-hidden>{cat.icon}</span>
            <span className="font-black leading-tight text-jeju-fg text-[length:var(--jeju-text-xl)] group-hover:text-jeju-accent">
              {cat.label}
            </span>
            <span className="rounded-full border border-jeju-border px-3 py-1 text-[length:var(--jeju-text-base)] text-jeju-fg-muted">
              준비 중
            </span>
          </Link>
        ))}
      </div>
    </JejuThemeShell>
  )
}
