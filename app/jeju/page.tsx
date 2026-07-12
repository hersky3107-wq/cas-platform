'use client'

import Link from 'next/link'
import { Building2, Palmtree, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

// ─────────────────────────────────────────────────────────────────────────────
// AX Jeju top-level entry (/jeju).
//
// Three symmetric mode tiles — 거버넌스 (amber) · 관광객 (teal) · 도민 (blue) —
// each with a subtle gradient + soft shadow for depth. Icons are normalized to
// one box size + one icon size so alignment is identical across tiles.
//
// 거버넌스 is the platform's core. It is signaled WITHOUT any badge/label —
// just a subtly stronger amber border + a soft amber glow on the tile (see
// `primary` prop below). Box sizes stay identical so the 3-tile row remains
// visually balanced.
//
// No raster/illustration assets — clean lucide line-icons only, for tonal
// consistency with all child screens. Routes unchanged.
// ─────────────────────────────────────────────────────────────────────────────

type ModeAccent = 'amber' | 'teal' | 'blue'

type ModeTileProps = {
  href: string
  icon: LucideIcon
  label: string
  description: string
  accent: ModeAccent
  /** Subtly elevate this tile (거버넌스) without any badge/label. */
  primary?: boolean
}

// Per-accent gradient + border + text. Box bg stays a neutral elevated surface
// so the icon glyph reads cleanly; the gradient lives behind it as depth.
// `primaryBorder` / `primaryShadow` are the slightly stronger variants applied
// only to the primary tile — tasteful, no size change.
const ACCENT: Record<
  ModeAccent,
  {
    gradient: string
    border: string
    hoverBorder: string
    label: string
    primaryBorder: string
    primaryShadow: string
  }
> = {
  amber: {
    gradient: 'from-amber-500 to-amber-700',
    border: 'border-amber-400/40',
    hoverBorder: 'hover:border-amber-400',
    label: 'text-amber-300',
    primaryBorder: 'border-amber-400/75',
    primaryShadow: '0 10px 34px -8px rgba(245, 158, 11, 0.45)',
  },
  teal: {
    gradient: 'from-teal-500 to-emerald-700',
    border: 'border-teal-400/40',
    hoverBorder: 'hover:border-teal-400',
    label: 'text-teal-300',
    primaryBorder: 'border-teal-400/40',
    primaryShadow: 'var(--jeju-shadow)',
  },
  blue: {
    gradient: 'from-blue-500 to-blue-800',
    border: 'border-blue-400/40',
    hoverBorder: 'hover:border-blue-400',
    label: 'text-blue-300',
    primaryBorder: 'border-blue-400/40',
    primaryShadow: 'var(--jeju-shadow)',
  },
}

function ModeTile({ href, icon: Icon, label, description, accent, primary = false }: ModeTileProps) {
  const a = ACCENT[accent]
  const border = primary ? a.primaryBorder : a.border
  const shadow = primary ? a.primaryShadow : 'var(--jeju-shadow)'
  return (
    <Link
      href={href}
      className={`group relative flex w-full flex-col items-center gap-5 rounded-[var(--jeju-radius)] border-2 ${border} ${a.hoverBorder} bg-jeju-tile-bg p-8 text-center transition hover:bg-jeju-tile-hover`}
      style={{ boxShadow: shadow }}
    >
      {/* Normalized icon box — identical size + centering across all three tiles. */}
      <div
        className={`relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-white/10 shadow-[var(--jeju-shadow)]`}
      >
        <div aria-hidden className={`absolute inset-0 bg-gradient-to-br ${a.gradient} opacity-90`} />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/10"
        />
        <Icon className="relative z-10 h-10 w-10 text-white drop-shadow" strokeWidth={1.75} aria-hidden />
      </div>

      <span className={`text-lg font-extrabold leading-tight ${a.label} sm:text-xl`}>{label}</span>
      <p className="max-w-[14rem] text-xs leading-snug text-jeju-fg-muted sm:text-sm">{description}</p>
    </Link>
  )
}

export default function JejuLobbyPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell theme="governance" title={t.lobbyTitle} tagline={t.lobbyTagline}>
      {/* Vertically center the tiles so the page reads as a confident entry,
          not top-heavy. min-h grows to fill the viewport. */}
      <div className="flex min-h-[60vh] items-center justify-center py-[var(--jeju-gap)]">
        <div className="grid w-full grid-cols-1 gap-[var(--jeju-gap)] sm:grid-cols-3">
          <ModeTile
            href="/jeju/governance"
            icon={Building2}
            label={t.modeGovernance}
            description={t.modeGovernanceDesc}
            accent="amber"
            primary
          />
          <ModeTile
            href="/jeju/tourist"
            icon={Palmtree}
            label={t.modeTourist}
            description={t.modeTouristDesc}
            accent="teal"
          />
          <ModeTile
            href="/jeju/resident"
            icon={Users}
            label={t.modeResident}
            description={t.modeResidentDesc}
            accent="blue"
          />
        </div>
      </div>
    </JejuThemeShell>
  )
}
