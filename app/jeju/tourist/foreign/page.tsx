'use client'

import { JejuPlaceholderPage } from '@/components/jeju/JejuPlaceholderPage'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuTouristForeignPage() {
  const { t } = useJejuUi()

  return (
    <JejuPlaceholderPage
      theme="tourist"
      title={t.foreignTitle}
      backHref="/jeju/tourist"
      backLabel={t.backToTourist}
    />
  )
}
