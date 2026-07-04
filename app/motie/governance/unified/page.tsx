'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Newspaper } from 'lucide-react'
import { JejuThemeShell } from '@/components/motie/JejuThemeShell'
import { useJejuUi } from '@/components/motie/useJejuUi'
import { DeliberateSection } from '@/app/motie/governance/deliberate/page'
import { BriefSection } from '@/app/motie/governance/brief/page'
import { DiagnosticSection } from '@/app/motie/governance/diagnostic/page'

// ── Local collapsible section wrapper (heading + 어미 설명 + body) ────────────

function UnifiedSection({
  title,
  explainer,
  defaultOpen = true,
  children,
}: {
  title: string
  explainer: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-2xl border border-jeju-border bg-jeju-bg-elevated shadow-[var(--jeju-shadow)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="flex flex-col gap-1">
          <span className="text-sm font-bold text-jeju-fg">{title}</span>
          <span className="text-xs leading-relaxed text-jeju-fg-muted">{explainer}</span>
        </span>
        <span className="mt-0.5 shrink-0 text-jeju-fg-muted" aria-hidden>
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </span>
      </button>
      {open && <div className="border-t border-jeju-border px-5 py-5">{children}</div>}
    </section>
  )
}

// ── Unified governance view (통합 심의): 찬반형 → 개방형 → 진단형 stacked ──────

export default function JejuGovernanceUnifiedPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title="통합 심의"
      tagline={t.governancePickerTagline}
    >
      <div className="flex flex-col gap-6">
        {/* Section 1 — 찬반형 심의 */}
        <UnifiedSection title={t.hubDeliberateTitle} explainer={t.hubDeliberateDesc}>
          <DeliberateSection />
        </UnifiedSection>

        {/* Section 2 — 개방형 브리핑 (open-brief engine only; no embedded diagnostic) */}
        <UnifiedSection title={t.hubBriefTitle} explainer={t.hubBriefDesc}>
          <BriefSection />
        </UnifiedSection>

        {/* Section 3 — 진단형 스캔 (standalone diagnostic engine with backing badges + legend) */}
        <UnifiedSection title={t.hubDiagnosticTitle} explainer={t.hubDiagnosticDesc}>
          <DiagnosticSection />
        </UnifiedSection>

        {/* 언론 동향 — separate engine, subtle footer link */}
        <div className="flex items-center justify-center border-t border-jeju-border pt-4">
          <Link
            href="/motie/governance/media"
            className="flex items-center gap-1.5 text-xs text-jeju-fg-muted transition-colors hover:text-jeju-accent"
          >
            <Newspaper className="h-3.5 w-3.5" aria-hidden />
            {t.hubMediaTitle}
          </Link>
        </div>
      </div>
    </JejuThemeShell>
  )
}
