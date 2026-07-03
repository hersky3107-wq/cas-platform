'use client'

import { FileSearch, Layers, Newspaper } from 'lucide-react'
import { JejuThemeShell } from '@/components/motie/JejuThemeShell'
import { JejuTile } from '@/components/motie/JejuTile'
import { JejuTileGrid } from '@/components/motie/JejuTileGrid'
import { useJejuUi } from '@/components/motie/useJejuUi'

export default function JejuGovernancePage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title={t.governancePickerTitle}
      tagline={t.governancePickerTagline}
    >
      <JejuTileGrid columns={3}>
        <JejuTile
          href="/motie/governance/deliberate"
          icon={Layers}
          label={t.deepTitle}
          description={t.deepDesc}
          theme="governance"
        />
        <JejuTile
          href="/motie/governance/brief"
          icon={FileSearch}
          label={t.liteTitle}
          description={t.liteDesc}
          theme="governance"
        />
        <JejuTile
          href="/motie/governance/media"
          icon={Newspaper}
          label={t.mediaTitle}
          description={t.mediaDesc}
          theme="governance"
        />
      </JejuTileGrid>
    </JejuThemeShell>
  )
}
