'use client'

import { MOTIE_FREE_TEXT_PROGRAM_CLOSED_MESSAGE } from '@/lib/motie/free-text-program'

export function MotieFreeTextProgramClosed() {
  return (
    <div className="rounded-2xl border border-jeju-border bg-jeju-bg-elevated px-6 py-10 text-center shadow-[var(--jeju-shadow)]">
      <p className="text-base font-semibold text-jeju-fg">{MOTIE_FREE_TEXT_PROGRAM_CLOSED_MESSAGE}</p>
    </div>
  )
}
