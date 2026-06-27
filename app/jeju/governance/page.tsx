'use client'

import { FileSearch, Layers, Newspaper } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { JejuTile } from '@/components/jeju/JejuTile'
import { JejuTileGrid } from '@/components/jeju/JejuTileGrid'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuGovernancePage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title={t.governancePickerTitle}
      tagline={t.governancePickerTagline}
      backHref="/jeju"
      backLabel={t.backToJejuLobby}
    >
      <JejuTileGrid columns={3}>
        <JejuTile
          href="/jeju/governance/deliberate"
          icon={Layers}
          label={t.deepTitle}
          description={t.deepDesc}
          theme="governance"
        />
        <JejuTile
          href="/jeju/governance/brief"
          icon={FileSearch}
          label={t.liteTitle}
          description={t.liteDesc}
          theme="governance"
        />
        <JejuTile
          href="/jeju/governance/media"
          icon={Newspaper}
          label={t.mediaTitle}
          description={t.mediaDesc}
          theme="governance"
        />
      </JejuTileGrid>
    </JejuThemeShell>
  )
}
