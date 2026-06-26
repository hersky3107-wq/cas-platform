'use client'

import { Building2, Palmtree, Users } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { JejuTile } from '@/components/jeju/JejuTile'
import { JejuTileGrid } from '@/components/jeju/JejuTileGrid'
import { useJejuUi } from '@/components/jeju/useJejuUi'

export default function JejuLobbyPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell theme="governance" title={t.lobbyTitle} tagline={t.lobbyTagline}>
      <JejuTileGrid columns={3}>
        <JejuTile
          href="/jeju/governance"
          icon={Building2}
          label={t.modeGovernance}
          description={t.modeGovernanceDesc}
          theme="governance"
        />
        <JejuTile
          href="/jeju/tourist"
          icon={Palmtree}
          label={t.modeTourist}
          description={t.modeTouristDesc}
          theme="tourist"
        />
        <JejuTile
          href="/jeju/resident"
          icon={Users}
          label={t.modeResident}
          description={t.modeResidentDesc}
          theme="resident"
        />
      </JejuTileGrid>
    </JejuThemeShell>
  )
}
