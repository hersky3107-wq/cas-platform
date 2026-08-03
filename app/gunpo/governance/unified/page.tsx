'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { JejuThemeShell } from '@/components/gunpo/JejuThemeShell'
import { useJejuUi } from '@/components/gunpo/useJejuUi'
import { DeliberateSection } from '@/app/gunpo/governance/deliberate/page'
import { BriefSection } from '@/app/gunpo/governance/brief/page'
import { MediaSection } from '@/app/gunpo/governance/media/page'
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
  strong = false,
  teaser,
  icon,
  children,
}: {
  title: string
  explainer: string
  defaultOpen?: boolean
  /**
   * primary = 찬반형 — visually dominant (70% product weight).
   * media = 언론 동향 — a "reveal" element (nothing is fetched until opened),
   * so its COLLAPSED header is styled to visibly invite a click (warm tint,
   * hover state, CTA pill, teaser line) while the section's outer
   * border/shadow stay identical to `default`.
   */
  variant?: 'default' | 'primary' | 'media'
  /**
   * Boosts a non-primary section's COLLAPSED header presence (slightly larger
   * title + a touch more padding) so a collapsed-by-default section doesn't
   * read as an afterthought next to sections that are open by default.
   * Ignored when variant === 'primary'. Implied by variant === 'media'.
   */
  strong?: boolean
  /** Short "here's what you'll get" line shown only while collapsed, under the explainer. */
  teaser?: string
  /** Small leading icon shown only while collapsed (e.g. 📰). */
  icon?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isPrimary = variant === 'primary'
  const isMedia = variant === 'media'
  const isStrong = !isPrimary && (strong || isMedia)
  const showInvite = isMedia && !open

  const containerClass = isPrimary
    ? 'rounded-2xl border-2 border-jeju-accent/55 bg-jeju-bg-elevated shadow-[var(--jeju-shadow)] ring-1 ring-jeju-accent/15'
    : isMedia
      ? 'rounded-2xl border border-jeju-border border-l-[3px] border-l-jeju-accent/70 bg-jeju-bg-elevated shadow-[var(--jeju-shadow)]'
      : 'rounded-2xl border border-jeju-border bg-jeju-bg-elevated shadow-[var(--jeju-shadow)]'

  const headerClass = [
    'flex w-full items-start justify-between gap-4 text-left cursor-pointer transition-colors',
    isStrong ? 'px-5 py-5' : 'px-5 py-4',
    showInvite ? 'bg-jeju-accent-soft hover:bg-jeju-accent/20' : 'hover:bg-jeju-fg/[0.03]',
  ].join(' ')

  return (
    <section className={containerClass}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={headerClass}>
        <span className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2">
            {showInvite && icon && (
              <span aria-hidden className="text-base leading-none">
                {icon}
              </span>
            )}
            <span
              className={
                isPrimary
                  ? 'text-base font-extrabold tracking-tight text-jeju-fg'
                  : isStrong
                    ? 'text-base font-bold text-jeju-fg'
                    : 'text-sm font-bold text-jeju-fg'
              }
            >
              {title}
            </span>
          </span>
          <span className="text-xs leading-relaxed text-jeju-fg-muted">{explainer}</span>
          {showInvite && teaser && (
            <span className="text-xs font-semibold leading-relaxed text-jeju-accent">
              {teaser}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-2">
          {showInvite && (
            <span className="rounded-full border border-jeju-accent/50 bg-jeju-bg-elevated px-3 py-1 text-xs font-bold text-jeju-accent">
              펼쳐보기
            </span>
          )}
          <span className="text-jeju-fg-muted" aria-hidden>
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </span>
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

        {/* Section 3 — 언론 동향. Collapsed by default: UnifiedSection only mounts
            its children when open, so MediaSection (which fetches on mount) does
            NOT run the 30–90s media fan-out until the user expands this section.
            variant="media" gives the collapsed header an inviting, clickable
            presentation (warm tint, hover state, CTA pill, teaser) without
            opening it or exceeding 찬반형's primary look. */}
        <UnifiedSection
          title={t.hubMediaTitle}
          explainer={t.hubMediaDesc}
          defaultOpen={false}
          variant="media"
          icon="📰"
          teaser="최근 5일 군포 언론·지역지 여론 동향을 자동 수집합니다 · 클릭해서 보기"
        >
          <MediaSection />
        </UnifiedSection>

        {/* Section 4 — 진단형 스캔: unlinked from nav for STEP10 (see import note above). */}
      </div>
    </JejuThemeShell>
  )
}
