'use client'

import Link from 'next/link'
import { HeartHandshake, LayoutGrid } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

// ─────────────────────────────────────────────────────────────────────────────
// 도민 mode entry — 일반 vs 어르신 split.
//
// Visual hierarchy reflects purpose:
//   - 일반    → cool blue, dashboard (grid) icon, default size. The info dashboard.
//   - 어르신  → WARM accent (orange/coral), noticeably larger card + larger heart
//              icon. The accessibility/large-text mode advertises itself right
//              here: bigger, clearer, warmer.
//
// Routes/hrefs are unchanged from the previous grid. No background image; warm
// accent uses Tailwind's orange family (consistent across the app palette).
// ─────────────────────────────────────────────────────────────────────────────

export default function JejuResidentPickerPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="resident"
      title={t.residentPickerTitle}
      tagline={t.residentPickerTagline}
      backHref="/jeju"
      backLabel={t.backToJejuLobby}
    >
      {/* Pull the choice toward the vertical center so the page doesn't read
          as top-heavy/empty. min-h grows to fill available viewport height. */}
      <div className="flex min-h-[62vh] flex-col items-stretch justify-center gap-[var(--jeju-gap)] py-[var(--jeju-gap)] sm:grid sm:min-h-[58vh] sm:grid-cols-[1fr_1.35fr] sm:items-center">
        {/* ── 일반 (cool blue, default size) ───────────────────────────────── */}
        <Link
          href="/jeju/resident/general"
          className="group flex flex-col items-center gap-5 rounded-[var(--jeju-radius)] border-2 border-jeju-border bg-jeju-tile-bg p-8 text-center shadow-[var(--jeju-shadow)] transition hover:border-jeju-accent hover:bg-jeju-tile-hover"
        >
          <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-jeju-border bg-jeju-bg-elevated shadow-[var(--jeju-shadow)]">
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-br from-blue-700 to-blue-900 opacity-30"
            />
            <LayoutGrid
              className="relative z-10 h-10 w-10 text-white drop-shadow"
              strokeWidth={2.25}
              aria-hidden
            />
          </div>
          <span className="text-[length:var(--jeju-text-xl)] font-bold leading-tight text-jeju-fg">
            {t.practicalTitle}
          </span>
          <p className="max-w-[16rem] text-[length:var(--jeju-text-base)] leading-snug text-jeju-fg-muted">
            {t.practicalDesc}
          </p>
        </Link>

        {/* ── 어르신 (warm accent, larger card + larger icon) ──────────────── */}
        <Link
          href="/jeju/resident/senior"
          className="group flex flex-col items-center gap-6 rounded-[var(--jeju-radius)] border-2 border-orange-400/70 bg-orange-50/80 p-10 text-center shadow-[var(--jeju-shadow)] transition hover:border-orange-500 hover:bg-orange-100/80"
        >
          <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border-2 border-orange-400/60 bg-white shadow-[var(--jeju-shadow)]">
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-br from-orange-400 to-rose-500 opacity-45"
            />
            <HeartHandshake
              className="relative z-10 h-12 w-12 text-white drop-shadow"
              strokeWidth={2.25}
              aria-hidden
            />
          </div>
          <span className="text-2xl font-extrabold leading-tight text-orange-700 sm:text-[length:var(--jeju-text-xl)]">
            {t.assistantTitle}
          </span>
          {/* whitespace-nowrap keeps "큰 글씨 · 읽어주기 · 복지 찾기" on one line;
              the larger card gives it room. */}
          <p className="max-w-[20rem] whitespace-nowrap text-[length:var(--jeju-text-base)] font-semibold leading-snug text-orange-800/80">
            {t.assistantDesc}
          </p>
        </Link>
      </div>
    </JejuThemeShell>
  )
}
