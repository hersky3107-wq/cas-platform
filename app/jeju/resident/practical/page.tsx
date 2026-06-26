'use client'

import { JejuPlaceholderPage } from '@/components/jeju/JejuPlaceholderPage'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuResidentPracticalPage() {
  const { t } = useJejuUi()

  return (
    <JejuPlaceholderPage
      theme="resident"
      title={t.practicalTitle}
      backHref="/jeju/resident"
      backLabel={t.backToResident}
    />
  )
}
