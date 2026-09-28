import 'server-only'

import { getResearchPacket } from '../../research'
import type { RealEstatePacketIo } from './real-estate-packet'

export const LIVE_REAL_ESTATE_IO: RealEstatePacketIo = {
  getResearchPacket: ({ round, budgetRemainingUsd, tier, forcedQueries }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier, forcedQueries }),
}
