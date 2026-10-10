'use client'

import type { CSSProperties } from 'react'
import type { ExpectedWindow } from '@/lib/crisis/hazards'
import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'

type Props = {
  t: CrisisUiPack
  triggerKey: string
  expectedWindow?: ExpectedWindow | null
  probability?: boolean
  className?: string
  style?: CSSProperties
}

export function TriggerChip({ t, triggerKey, expectedWindow, probability, className, style }: Props) {
  const line = t.triggerChipLine(triggerKey, expectedWindow)
  const tip = probability ? `${t.probabilityForecast}. ${t.triggerExplanation(triggerKey)}` : t.triggerExplanation(triggerKey)
  return (
    <span title={tip} className={className} style={style}>
      {line}
    </span>
  )
}
