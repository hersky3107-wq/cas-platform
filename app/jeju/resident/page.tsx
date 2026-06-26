'use client'

import { HeartHandshake, Wrench } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { JejuTile } from '@/components/jeju/JejuTile'
import { JejuTileGrid } from '@/components/jeju/JejuTileGrid'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuResidentPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="resident"
      title={t.residentPickerTitle}
      tagline={t.residentPickerTagline}
      backHref="/jeju"
      backLabel={t.backToJejuLobby}
    >
      <JejuTileGrid columns={2}>
        <JejuTile
          href="/jeju/resident/practical"
          icon={Wrench}
          label={t.practicalTitle}
          description={t.practicalDesc}
          theme="resident"
        />
        <JejuTile
          href="/jeju/resident/assistant"
          icon={HeartHandshake}
          label={t.assistantTitle}
          description={t.assistantDesc}
          theme="resident"
        />
      </JejuTileGrid>
    </JejuThemeShell>
  )
}
