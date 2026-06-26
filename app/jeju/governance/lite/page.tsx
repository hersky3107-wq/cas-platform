'use client'

import { JejuPlaceholderPage } from '@/components/jeju/JejuPlaceholderPage'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuGovernanceLitePage() {
  const { t } = useJejuUi()

  return (
    <JejuPlaceholderPage
      theme="governance"
      title={t.liteTitle}
      backHref="/jeju/governance"
      backLabel={t.backToGovernance}
    />
  )
}
