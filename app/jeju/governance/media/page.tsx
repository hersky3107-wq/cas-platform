'use client'

import { JejuPlaceholderPage } from '@/components/jeju/JejuPlaceholderPage'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuGovernanceMediaPage() {
  const { t } = useJejuUi()

  return (
    <JejuPlaceholderPage
      theme="governance"
      title={t.mediaTitle}
      backHref="/jeju/governance"
      backLabel={t.backToGovernance}
    />
  )
}
