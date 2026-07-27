'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { JejuThemeShell } from '@/components/gunpo/JejuThemeShell'
import { useJejuUi } from '@/components/gunpo/useJejuUi'
import { DeliberateSection } from '@/app/gunpo/governance/deliberate/page'
import { BriefSection } from '@/app/gunpo/governance/brief/page'
// NOTE (STEP10): 진단형(diagnostic) tab intentionally unlinked from the
// governance landing/nav per user decision — the route + page itself
// (app/gunpo/governance/diagnostic, app/api/gunpo/diagnostic) is left intact
// so it can be re-linked later. Re-add the import + <UnifiedSection> block
// below to restore it.
// import { DiagnosticSection } from '@/app/gunpo/governance/diagnostic/page'

// ── Local collapsible section wrapper (heading + 어미 설명 + body) ────────────

function UnifiedSection({
  title,
  explainer,
  defaultOpen = true,
  variant = 'default',
  children,
}: {
  title: string
  explainer: string
  defaultOpen?: boolean
  /** primary = 찬반형 — visually dominant (70% product weight) */
  variant?: 'default' | 'primary'
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isPrimary = variant === 'primary'
  return (
    <section
      className={
        isPrimary
          ? 'rounded-2xl border-2 border-jeju-accent/55 bg-jeju-bg-elevated shadow-[var(--jeju-shadow)] ring-1 ring-jeju-accent/15'
          : 'rounded-2xl border border-jeju-border bg-jeju-bg-elevated shadow-[var(--jeju-shadow)]'
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="flex flex-col gap-1">
          <span
            className={
              isPrimary
                ? 'text-base font-extrabold tracking-tight text-jeju-fg'
                : 'text-sm font-bold text-jeju-fg'
            }
          >
            {title}
          </span>
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

// ── Unified governance view (통합 심의): 찬반형 → 개방형 stacked (진단형 unlinked) ──

export default function JejuGovernanceUnifiedPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title="통합 심의"
      tagline={t.governancePickerTagline}
    >
      <div className="flex flex-col gap-6">
        {/* Section 1 — 찬반형 심의 (primary product — visually dominant) */}
        <UnifiedSection
          title={t.hubDeliberateTitle}
          explainer={t.hubDeliberateDesc}
          variant="primary"
        >
          <DeliberateSection />
        </UnifiedSection>

        {/* Section 2 — 개방형 브리핑 (open-brief engine only; no embedded diagnostic) */}
        <UnifiedSection title={t.hubBriefTitle} explainer={t.hubBriefDesc}>
          <BriefSection />
        </UnifiedSection>

        {/* Section 3 — 진단형 스캔: unlinked from nav for STEP10 (see import note above). */}
      </div>
    </JejuThemeShell>
  )
}
