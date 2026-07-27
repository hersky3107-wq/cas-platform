'use client'

import type { JejuThemeId } from '@/lib/gunpo/ui-labels'
import { JejuThemeShell } from './JejuThemeShell'
import { useJejuUi } from './useJejuUi'

type JejuPlaceholderPageProps = {
  theme: JejuThemeId
  title: string
  backHref: string
  backLabel: string
}

export function JejuPlaceholderPage({
  theme,
  title,
  backHref,
  backLabel,
}: JejuPlaceholderPageProps) {
  const { t } = useJejuUi()
  const isResident = theme === 'resident'

  return (
    <JejuThemeShell theme={theme} title={title} backHref={backHref} backLabel={backLabel}>
      <div
        className={`mx-auto max-w-lg rounded-2xl border bg-jeju-bg-elevated text-center ${
          isResident
            ? 'border-2 border-jeju-border px-8 py-12'
            : 'border border-jeju-border px-6 py-10'
        }`}
      >
        <p
          className={`font-bold text-jeju-accent ${
            isResident ? 'text-[length:var(--jeju-text-xl)]' : 'text-lg'
          }`}
        >
          {t.placeholderNote}
        </p>
        <p
          className={`mt-4 text-jeju-fg-muted ${
            isResident ? 'text-[length:var(--jeju-text-lg)] leading-relaxed' : 'text-sm leading-relaxed'
          }`}
        >
          {t.placeholderBody}
        </p>
      </div>
    </JejuThemeShell>
  )
}
