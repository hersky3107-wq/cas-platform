'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import type { JejuThemeId } from '@/lib/gunpo/ui-labels'

type JejuTileProps = {
  href: string
  icon: LucideIcon
  label: string
  description: string
  theme: JejuThemeId
  badge?: string
}

const ICON_GRADIENT: Record<JejuThemeId, string> = {
  governance: 'from-amber-600/80 to-amber-900/90',
  tourist: 'from-teal-500 to-emerald-700',
  resident: 'from-blue-700 to-blue-900',
}

export function JejuTile({ href, icon: Icon, label, description, theme, badge }: JejuTileProps) {
  const isResident = theme === 'resident'
  const isGovernance = theme === 'governance'

  return (
    <Link
      href={href}
      className={`group flex flex-col items-center text-center transition ${
        isResident ? 'gap-4' : 'gap-2'
      }`}
    >
      <div className="relative">
        <div
          className={`relative flex items-center justify-center overflow-hidden rounded-2xl border shadow-[var(--jeju-shadow)] transition group-hover:bg-jeju-tile-hover ${
            isResident
              ? 'h-[var(--jeju-tile-size-lg)] w-[var(--jeju-tile-size-lg)] border-2 border-jeju-border bg-jeju-tile-bg'
              : 'h-[var(--jeju-tile-size)] w-[var(--jeju-tile-size)] border border-jeju-border bg-jeju-tile-bg lg:h-[var(--jeju-tile-size-lg)] lg:w-[var(--jeju-tile-size-lg)]'
          }`}
        >
          <div
            className={`absolute inset-0 bg-gradient-to-br opacity-90 ${ICON_GRADIENT[theme]} ${
              isGovernance ? 'opacity-40' : isResident ? 'opacity-25' : 'opacity-30'
            }`}
          />
          <Icon
            className={`relative z-10 text-white drop-shadow ${
              isResident ? 'h-12 w-12 lg:h-14 lg:w-14' : 'h-9 w-9 lg:h-11 lg:w-11'
            }`}
            strokeWidth={isResident ? 2.25 : 1.75}
            aria-hidden
          />
        </div>
        {badge ? (
          <span
            className={`absolute -bottom-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-jeju-border bg-jeju-bg-elevated px-2 py-0.5 font-semibold text-jeju-accent-secondary ${
              isResident ? 'text-sm' : 'text-[10px]'
            }`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <span
        className={`font-bold leading-tight ${
          isResident ? 'text-[length:var(--jeju-text-lg)]' : 'text-sm sm:text-base'
        }`}
      >
        {label}
      </span>
      <p
        className={`max-w-[12rem] leading-snug text-jeju-fg-muted ${
          isResident ? 'text-[length:var(--jeju-text-base)]' : 'text-[10px] sm:text-xs'
        }`}
      >
        {description}
      </p>
    </Link>
  )
}
