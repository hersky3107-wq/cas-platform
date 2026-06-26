'use client'

import { JejuPlaceholderPage } from '@/components/jeju/JejuPlaceholderPage'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuResidentAssistantPage() {
  const { t } = useJejuUi()

  return (
    <JejuPlaceholderPage
      theme="resident"
      title={t.assistantTitle}
      backHref="/jeju/resident"
      backLabel={t.backToResident}
    />
  )
}
