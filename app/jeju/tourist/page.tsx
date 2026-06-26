'use client'

import { Globe, MapPin } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { JejuTile } from '@/components/jeju/JejuTile'
import { JejuTileGrid } from '@/components/jeju/JejuTileGrid'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuTouristPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="tourist"
      title={t.touristPickerTitle}
      tagline={t.touristPickerTagline}
      backHref="/jeju"
      backLabel={t.backToJejuLobby}
    >
      <JejuTileGrid columns={2}>
        <JejuTile
          href="/jeju/tourist/domestic"
          icon={MapPin}
          label={t.domesticTitle}
          description={t.domesticDesc}
          theme="tourist"
        />
        <JejuTile
          href="/jeju/tourist/foreign"
          icon={Globe}
          label={t.foreignTitle}
          description={t.foreignDesc}
          theme="tourist"
          badge={t.foreignBadge}
        />
      </JejuTileGrid>
    </JejuThemeShell>
  )
}
