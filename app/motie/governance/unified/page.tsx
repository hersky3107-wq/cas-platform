'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { JejuThemeShell } from '@/components/motie/JejuThemeShell'
import { useJejuUi } from '@/components/motie/useJejuUi'
import { DeliberateSection } from '@/app/motie/governance/deliberate/page'

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
      backHref="/motie/governance"
      backLabel={t.backToGovernance}
    >
      <div className="flex flex-col gap-6">
        {/* Section 1 — 찬반형 심의 */}
        <UnifiedSection title={t.hubDeliberateTitle} explainer={t.hubDeliberateDesc}>
          <DeliberateSection />
        </UnifiedSection>

        {/* B-2 PLACEHOLDER — 개방형 브리핑 section goes here (BriefSection). Not implemented yet. */}

        {/* B-3 PLACEHOLDER — 진단형 스캔 section goes here (DiagnosticSection). Not implemented yet. */}
      </div>
    </JejuThemeShell>
  )
}
