'use client'

import Link from 'next/link'
import { Building2, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { JejuThemeShell } from '@/components/gunpo/JejuThemeShell'
import { useJejuUi } from '@/components/gunpo/useJejuUi'

type ModeAccent = 'amber' | 'blue'

type ModeTileProps = {
  href: string
  icon: LucideIcon
  label: string
  description: string
  accent: ModeAccent
  primary?: boolean
}

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
      <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-white/10 shadow-[var(--jeju-shadow)]">
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

export default function GunpoLobbyPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell theme="governance" title={t.brandTitle}>
      <div className="flex min-h-[60vh] items-center justify-center py-[var(--jeju-gap)]">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-[var(--jeju-gap)] sm:grid-cols-2">
          <ModeTile
            href="/gunpo/governance/unified"
            icon={Building2}
            label="시정 업무"
            description="8개 AI 심의체 — 정책 안건 분석·검토"
            accent="amber"
            primary
          />
          <ModeTile
            href="/gunpo/resident/general"
            icon={Users}
            label="군포시민"
            description="날씨·교통·복지·생활정보"
            accent="blue"
          />
        </div>
      </div>
    </JejuThemeShell>
  )
}
