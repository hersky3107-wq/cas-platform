'use client'

import Link from 'next/link'
import { Archive, FileSearch, Layers, Newspaper, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

// ─────────────────────────────────────────────────────────────────────────────
// Governance lobby. 심층 심의 is the hero (full-width, larger, "핵심" badge);
// below it, three equal cards: 현안 브리핑 (accent variant, the #2 feature),
// 언론 동향, 기록. Routes/hrefs are unchanged from the previous grid — only
// labels, colors, sizing and layout changed.
// ─────────────────────────────────────────────────────────────────────────────

function GovernanceHeroCard({
  href,
  icon: Icon,
  label,
  subDesc,
}: {
  href: string
  icon: LucideIcon
  label: string
  subDesc: string
}) {
  return (
    <Link
      href={href}
      className="group relative flex w-full flex-col gap-4 overflow-hidden rounded-[var(--jeju-radius)] border border-jeju-accent/55 bg-jeju-tile-bg p-6 shadow-[var(--jeju-shadow)] transition hover:border-jeju-accent hover:bg-jeju-tile-hover sm:flex-row sm:items-center sm:gap-6 sm:p-8"
    >
      {/* Hero glow — strongest at low-left, fades out. No background image. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-jeju-accent/25 blur-3xl transition group-hover:bg-jeju-accent/35"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-jeju-accent-secondary/20 blur-3xl"
      />

      <div className="relative z-10 flex shrink-0 items-center justify-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-jeju-accent/45 bg-jeju-bg-elevated shadow-[var(--jeju-shadow)] sm:h-20 sm:w-20">
          <div
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-600/80 to-amber-900/90 opacity-50"
          />
          <Icon className="relative z-10 h-8 w-8 text-white drop-shadow sm:h-10 sm:w-10" strokeWidth={1.75} aria-hidden />
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-1.5 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-extrabold tracking-tight text-jeju-fg sm:text-2xl">{label}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-jeju-accent/60 bg-jeju-accent-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-jeju-accent">
            <Sparkles className="h-3 w-3" aria-hidden />
            핵심
          </span>
        </div>
        <p className="text-sm leading-snug text-jeju-fg-muted sm:text-base">{subDesc}</p>
      </div>

      <span
        aria-hidden
        className="relative z-10 hidden shrink-0 items-center self-center text-jeju-accent transition group-hover:translate-x-1 sm:flex"
      >
        →
      </span>
    </Link>
  )
}

function GovernanceQuietCard({
  href,
  icon: Icon,
  label,
  description,
  variant = 'quiet',
}: {
  href: string
  icon: LucideIcon
  label: string
  description: string
  variant?: 'quiet' | 'accent'
}) {
  // 현안 브리핑 gets a distinct accent (sky/teal-ish) to mark it as the #2
  // feature; 언론 동향 and 기록 stay in the default quiet style.
  const isAccent = variant === 'accent'
  return (
    <Link
      href={href}
      className={`group flex w-full flex-col items-center gap-3 rounded-[var(--jeju-radius)] border bg-jeju-tile-bg p-5 text-center shadow-[var(--jeju-shadow)] transition ${
        isAccent
          ? 'border-sky-400/55 hover:border-sky-400 hover:bg-sky-400/10'
          : 'border-jeju-border hover:border-jeju-accent/50 hover:bg-jeju-tile-hover'
      }`}
    >
      <div
        className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border shadow-[var(--jeju-shadow)] ${
          isAccent ? 'border-sky-400/45 bg-jeju-bg-elevated' : 'border-jeju-border bg-jeju-bg-elevated'
        }`}
      >
        <div
          aria-hidden
          className={`absolute inset-0 bg-gradient-to-br ${
            isAccent ? 'from-sky-500 to-indigo-700' : 'from-amber-600/80 to-amber-900/90'
          } ${isAccent ? 'opacity-40' : 'opacity-35'}`}
        />
        <Icon className="relative z-10 h-7 w-7 text-white drop-shadow" strokeWidth={1.75} aria-hidden />
      </div>
      <span
        className={`font-bold leading-tight ${
          isAccent ? 'text-sky-300' : 'text-jeju-fg'
        } text-sm sm:text-base`}
      >
        {label}
      </span>
      <p className="max-w-[14rem] text-[11px] leading-snug text-jeju-fg-muted sm:text-xs">{description}</p>
    </Link>
  )
}

export default function JejuGovernancePage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title={t.governancePickerTitle}
      tagline={t.governancePickerTagline}
      backHref="/jeju"
      backLabel={t.backToJejuLobby}
    >
      <div className="flex flex-col gap-[var(--jeju-gap)]">
        {/* HERO: 심층 심의 — full-width, larger, strongest visual weight. */}
        <GovernanceHeroCard
          href="/jeju/governance/deliberate"
          icon={Layers}
          label={t.deepTitle}
          subDesc={t.deepSubDesc}
        />

        {/* Row of 3 equal cards: 현안 브리핑 (accent) · 언론 동향 · 기록 (quiet). */}
        <div className="grid grid-cols-1 gap-[var(--jeju-gap)] sm:grid-cols-3">
          <GovernanceQuietCard
            href="/jeju/governance/brief"
            icon={FileSearch}
            label={t.liteTitle}
            description={t.liteSubDesc}
            variant="accent"
          />
          <GovernanceQuietCard
            href="/jeju/governance/media"
            icon={Newspaper}
            label={t.mediaTitle}
            description={t.mediaDesc}
          />
          <GovernanceQuietCard
            href="/jeju/governance/archive"
            icon={Archive}
            label={t.archiveTitle}
            description={t.archiveDesc}
          />
        </div>
      </div>
    </JejuThemeShell>
  )
}
