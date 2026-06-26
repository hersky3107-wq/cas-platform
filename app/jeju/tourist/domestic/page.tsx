'use client'

import { JejuPlaceholderPage } from '@/components/jeju/JejuPlaceholderPage'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuTouristDomesticPage() {
  const { t } = useJejuUi()

  return (
    <JejuPlaceholderPage
      theme="tourist"
      title={t.domesticTitle}
      backHref="/jeju/tourist"
      backLabel={t.backToTourist}
    />
  )
}
