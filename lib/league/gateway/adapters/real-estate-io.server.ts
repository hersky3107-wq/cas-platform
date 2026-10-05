import 'server-only'

import { loadHousingForPacket } from '../../real-estate/load.server'
import { getResearchPacket } from '../../research'
import type { RealEstatePacketIo } from './real-estate-packet'

export const LIVE_REAL_ESTATE_IO: RealEstatePacketIo = {
  getResearchPacket: ({ round, budgetRemainingUsd, tier, forcedQueries }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier, forcedQueries }),
  loadHousingIndex: (parts) => loadHousingForPacket(parts),
}
