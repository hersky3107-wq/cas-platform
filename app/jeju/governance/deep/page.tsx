'use client'

import { JejuPlaceholderPage } from '@/components/jeju/JejuPlaceholderPage'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuGovernanceDeepPage() {
  const { t } = useJejuUi()

  return (
    <JejuPlaceholderPage
      theme="governance"
      title={t.deepTitle}
      backHref="/jeju/governance"
      backLabel={t.backToGovernance}
    />
  )
}
