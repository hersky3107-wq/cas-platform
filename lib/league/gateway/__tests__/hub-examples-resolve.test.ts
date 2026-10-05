import { describe, expect, it } from 'vitest'
import { ENTERTAINMENT_SLATE } from '../../entertainment/slate'
import { createEntertainmentAdapter } from '../adapters/entertainment'
import type { EntertainmentPacketIo } from '../adapters/entertainment-packet'
import { createPoliticsAdapter } from '../adapters/politics'
import type { PoliticsPacketIo } from '../adapters/politics-packet'
import { createRealEstateAdapter } from '../adapters/real-estate'
import type { RealEstatePacketIo } from '../adapters/real-estate-packet'
import { createSportsAdapter } from '../adapters/sports'
import type { SportsPacketIo } from '../adapters/sports-packet'
import { createTechAdapter } from '../adapters/tech'
import { listHubExamples } from '../hub-examples'
import type { CategoryAdapter, EntityResolution, GatewayViewer } from '../types'
import type { ElectionCandidateLite } from '../../politics/markets'

const NOW = new Date('2026-10-01T12:00:00.000Z')

const US: GatewayViewer = {
  userId: 'hub-check',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
}

const DEAD_RESEARCH = async () => {
  throw new Error('research must not run in the hub-example checker')
}

const SPORTS_IO: SportsPacketIo = {
  listUpcomingFixtures: async () => [
    {
      fixture_id: 'evt-ars-lee',
      league: 'soccer_epl',
      home: 'Arsenal',
      away: 'Leeds United',
      kickoff: '2026-10-10T11:30:00.000Z',
    },
    {
      fixture_id: 'evt-lad-nyy',
      league: 'baseball_mlb',
      home: 'Los Angeles Dodgers',
      away: 'New York Yankees',
      kickoff: '2026-10-05T00:10:00.000Z',
    },
  ],
  searchFootballFixtures: async (query) => {
    if (/울산|ulsan|ウルサン|蔚山|أولسان/i.test(query)) {
      return [
        {
          fixture_id: 'af-1507081',
          league: 'soccer_korea_kleague1',
          home: 'Gwangju FC',
          away: 'Ulsan Hyundai FC',
          kickoff: '2026-10-11T05:00:00.000Z',
        },
      ]
    }
    return []
  },
  readFixture: DEAD_RESEARCH as SportsPacketIo['readFixture'],
  fetchFixtureStats: DEAD_RESEARCH as SportsPacketIo['fetchFixtureStats'],
  getResearchPacket: DEAD_RESEARCH as SportsPacketIo['getResearchPacket'],
}

const POLITICS_SLATE: ElectionCandidateLite[] = [
  {
    jurisdiction: 'US',
    office: 'governor',
    cycle: '2026',
    district: 'GA',
    candidate: 'Stacey Abrams',
    pollCloseIso: '2026-11-03T23:00:00.000Z',
    kalshiPct: 41,
    polymarketPct: 44,
  },
]

const POLITICS_IO: PoliticsPacketIo = {
  listUpcoming: async () => POLITICS_SLATE,
  readBaseline: async () => ({ kalshiPct: 41, polymarketPct: 44 }),
  readPolls: async () => [],
  getResearchPacket: DEAD_RESEARCH as PoliticsPacketIo['getResearchPacket'],
}

const ENTERTAINMENT_IO: EntertainmentPacketIo = {
  listUpcoming: async () => [...ENTERTAINMENT_SLATE],
  readBaseline: async () => ({ marketPct: null, trackingNote: null }),
  getResearchPacket: DEAD_RESEARCH as EntertainmentPacketIo['getResearchPacket'],
}

const REAL_ESTATE_IO: RealEstatePacketIo = {
  getResearchPacket: DEAD_RESEARCH as RealEstatePacketIo['getResearchPacket'],
}

const TECH_IO = { getResearchPacket: DEAD_RESEARCH }

const adapters: Record<string, CategoryAdapter> = {
  sports: createSportsAdapter(SPORTS_IO, () => NOW),
  politics_election: createPoliticsAdapter(POLITICS_IO, () => NOW),
  entertainment: createEntertainmentAdapter(ENTERTAINMENT_IO, () => NOW),
  real_estate: createRealEstateAdapter(REAL_ESTATE_IO, () => NOW),
  tech: createTechAdapter(TECH_IO, () => NOW),
}

function refused(hit: EntityResolution): string | null {
  if (hit.ok) return null
  if ('refuse' in hit) return hit.refuse.code
  return null
}

describe('hub examples resolve offline', () => {
  it('lists examples for every locale and free-prompt hub', () => {
    const rows = listHubExamples()
    expect(rows.length).toBeGreaterThan(40)
    const locales = new Set(rows.map((r) => r.locale))
    expect([...locales].sort()).toEqual(['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'zh-TW'])
    expect(rows.some((r) => r.hub === 'sports' && /아스날이 다음 경기/.test(r.text))).toBe(true)
    expect(rows.some((r) => /토트넘이 아스날을|Tottenham beat Arsenal|Yankees beat the Red Sox/.test(r.text))).toBe(
      false,
    )
  })

  it('resolves every published hub example without a refusal', async () => {
    const misses: string[] = []
    for (const row of listHubExamples()) {
      const adapter = adapters[row.category]
      if (!adapter) {
        misses.push(`${row.locale} ${row.hub}: no adapter for ${row.category}`)
        continue
      }
      const hit = await adapter.resolveEntity(row.text, row.locale, US)
      const code = refused(hit)
      if (code) misses.push(`${row.locale} ${row.hub}: ${code} — ${row.text}`)
    }
    expect(misses, misses.join('\n')).toEqual([])
  })
})
