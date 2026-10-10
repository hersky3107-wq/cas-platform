'use client'

import type { CSSProperties } from 'react'
import type { ExpectedWindow } from '@/lib/crisis/hazards'
import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'

type Props = {
  t: CrisisUiPack
  triggerKey: string
  expectedWindow?: ExpectedWindow | null
  className?: string
  style?: CSSProperties
}

export function TriggerChip({ t, triggerKey, expectedWindow, className, style }: Props) {
  const line = t.triggerChipLine(triggerKey, expectedWindow)
  const tip = t.triggerExplanation(triggerKey)
  return (
    <span title={tip} className={className} style={style}>
      {line}
    </span>
  )
}
