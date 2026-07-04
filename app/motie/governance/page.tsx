'use client'

import { Activity, FileSearch, Layers, Newspaper } from 'lucide-react'
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
      <JejuTileGrid columns={2}>
        <JejuTile
          href="/motie/governance/deliberate"
          icon={Layers}
          label={t.hubDeliberateTitle}
          description={t.hubDeliberateDesc}
          theme="governance"
        />
        <JejuTile
          href="/motie/governance/brief"
          icon={FileSearch}
          label={t.hubBriefTitle}
          description={t.hubBriefDesc}
          theme="governance"
        />
        <JejuTile
          href="/motie/governance/diagnostic"
          icon={Activity}
          label={t.hubDiagnosticTitle}
          description={t.hubDiagnosticDesc}
          theme="governance"
        />
        <JejuTile
          href="/motie/governance/media"
          icon={Newspaper}
          label={t.hubMediaTitle}
          description={t.hubMediaDesc}
          theme="governance"
        />
      </JejuTileGrid>
    </JejuThemeShell>
  )
}
