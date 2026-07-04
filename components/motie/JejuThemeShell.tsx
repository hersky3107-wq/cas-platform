'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { JejuThemeId } from '@/lib/motie/ui-labels'
import { useJejuUi } from './useJejuUi'
import { MotieModeBand } from './MotieModeBand'
import { useMotieMode } from './mode-context'

type JejuThemeShellProps = {
  theme: JejuThemeId
  title?: string
  tagline?: string
  backHref?: string
  backLabel?: string
  children: React.ReactNode
}

export function JejuThemeShell({
  theme,
  title,
  tagline,
  backHref,
  backLabel,
  children,
}: JejuThemeShellProps) {
  const { t } = useJejuUi()
  const isResident = theme === 'resident'

  // For governance pages, the effective theme follows councilMode so the
  // trade/warroom CSS palettes apply. The MotieModeContext default ('trade')
  // is always defined, so this is safe even without an explicit provider.
  const { mode } = useMotieMode()
  const effectiveTheme: string = theme === 'governance' ? mode : theme

  return (
    <div
      data-jeju-theme={effectiveTheme}
      className="min-h-screen bg-jeju-bg text-jeju-fg"
      style={{ fontSize: 'var(--jeju-text-base)' }}
    >
      <MotieModeBand />
      <header
        className={`flex items-center gap-3 px-4 py-4 sm:px-8 ${
          isResident ? 'border-b-2 border-jeju-border' : 'border-b border-jeju-border'
        }`}
      >
        {backHref ? (
          <Link
            href={backHref}
            className={`inline-flex min-h-[var(--jeju-tap-min)] items-center gap-1 rounded-lg px-3 font-semibold text-jeju-accent transition hover:bg-jeju-tile-hover ${
              isResident ? 'text-[length:var(--jeju-text-lg)]' : 'text-sm'
            }`}
          >
            <ChevronLeft className={isResident ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden />
            {backLabel ?? t.back}
          </Link>
        ) : (
          <span className="w-16" aria-hidden />
        )}
        <div className="min-w-0 flex-1 text-center">
          {title ? (
            <h1
              className={`truncate font-bold tracking-tight ${
                isResident ? 'text-[length:var(--jeju-text-xl)]' : 'text-[length:var(--jeju-text-lg)]'
              }`}
            >
              {title}
            </h1>
          ) : null}
          {tagline ? (
            <p
              className={`mt-0.5 truncate text-jeju-fg-muted ${
                isResident ? 'text-[length:var(--jeju-text-base)]' : 'text-xs sm:text-sm'
              }`}
            >
              {tagline}
            </p>
          ) : null}
        </div>
        <span className="w-16 shrink-0" aria-hidden />
      </header>

      <main className="mx-auto w-full max-w-4xl px-6 py-10 sm:px-10 sm:py-14">{children}</main>
    </div>
  )
}
