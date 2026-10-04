import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { LEAGUE_ROSTER } from '../../roster'
import {
  leagueRosterVendorBrands,
  mapVendorBrand,
  OTHER_VENDOR_BRAND,
} from '../brands'
import {
  alreadyRefreshedToday,
  ARTIFICIAL_ANALYSIS_INGEST,
  BACKFILL_ARENAS,
  brandRanking,
  ingestAiLeaderboard,
  LMARENA_ATTRIBUTION,
  LMARENA_HAS_KOREAN_CATEGORY,
  LMARENA_LICENSE,
  LMARENA_TEXT_CATEGORIES,
  mapLmarenaRow,
  planAiLeaderboardIngest,
  refreshAiLeaderboardDaily,
  type AiLeaderboardRow,
} from '../ingest'
import {
  parseAiLeaderboardBackfillArgs,
  runAiLeaderboardBackfill,
} from '../../../../scripts/league/ai-leaderboard-backfill'

const ROOT = join(__dirname, '../../../..')

function row(partial: Partial<AiLeaderboardRow> & Pick<AiLeaderboardRow, 'model' | 'brand' | 'rank'>): AiLeaderboardRow {
  return {
    source: 'lmarena',
    arena: 'text',
    category: 'overall',
    publish_date: '2026-10-02',
    organization: null,
    score: null,
    votes: null,
    ...partial,
  }
}

describe('LMArena license + Artificial Analysis', () => {
  it('keeps the dataset-card license and later-display attribution', () => {
    expect(LMARENA_LICENSE).toBe('cc-by-4.0')
    expect(LMARENA_ATTRIBUTION).toBe('순위 데이터: LMArena (CC BY 4.0)')
    expect(ARTIFICIAL_ANALYSIS_INGEST).toBe('not ingested')
    expect(LMARENA_HAS_KOREAN_CATEGORY).toBe(true)
    expect(LMARENA_TEXT_CATEGORIES).toContain('korean')
    expect(LMARENA_TEXT_CATEGORIES).toContain('overall')
    expect(BACKFILL_ARENAS).toEqual(['text', 'webdev', 'vision', 'text_to_image', 'text_to_video', 'search'])
  })
})

describe('vendor brand mapping', () => {
  it('maps known organizations and leaves unknown orgs as 기타', () => {
    expect(mapVendorBrand('openai', 'gpt-6-astra').brand).toBe('OpenAI')
    expect(mapVendorBrand('google', 'gemini-3.8-flash-high').brand).toBe('Google')
    expect(mapVendorBrand('anthropic', 'claude-fable-5.1-max').brand).toBe('Anthropic')
    expect(mapVendorBrand('xai', 'grok-4.7-xhigh').brand).toBe('xAI')
    expect(mapVendorBrand('meta', 'muse-spark-1.3-max').brand).toBe('Meta')
    expect(mapVendorBrand('deepseek', 'deepseek-v4.1-flash-max').brand).toBe('DeepSeek')
    expect(mapVendorBrand('alibaba', 'qwen3.8-max').brand).toBe('Alibaba/Qwen')
    expect(mapVendorBrand('moonshot', 'kimi-k3-max').brand).toBe('Moonshot')
    expect(mapVendorBrand('zai', 'glm-5.3-max').brand).toBe('Zhipu/GLM')
    expect(mapVendorBrand('Zhipu AI', 'glm-4').brand).toBe('Zhipu/GLM')
    expect(mapVendorBrand('minimax', 'minimax-m3').brand).toBe('MiniMax')
    expect(mapVendorBrand('mistral', 'mistral-medium-3.5').brand).toBe('Mistral')
    expect(mapVendorBrand('microsoft', 'phi-4').brand).toBe('Microsoft')
    expect(mapVendorBrand('nvidia', 'nvidia-nemotron-3-ultra').brand).toBe('NVIDIA')
    expect(mapVendorBrand('amazon', 'nova-2-lite').brand).toBe('Amazon')
    expect(mapVendorBrand('tencent', 'hy3').brand).toBe('Tencent')
    expect(mapVendorBrand('bytedance', 'seed-1.6').brand).toBe('ByteDance')
    expect(mapVendorBrand('xiaomi', 'mimo-v2.5').brand).toBe('Xiaomi')
    expect(mapVendorBrand('cohere', 'command-a-03-2025').brand).toBe('Cohere')
    expect(mapVendorBrand('upstage', 'solar-pro4').brand).toBe('Upstage')
    expect(mapVendorBrand('naver', 'hcx-007').brand).toBe('NAVER')

    const unknown = mapVendorBrand('stepfun', 'Step 5 Preview')
    expect(unknown.brand).toBe(OTHER_VENDOR_BRAND)
    expect(unknown.unmappedOrganization).toBe('stepfun')
    expect(mapVendorBrand('thinky', 'inkling').unmappedOrganization).toBe('thinky')
    expect(mapVendorBrand('ibm', 'granite-4.2-8b').unmappedOrganization).toBe('ibm')
    expect(mapVendorBrand(null, 'gpt-6-astra').brand).toBe('OpenAI')
    expect(mapVendorBrand('', 'claude-sonnet-5').brand).toBe('Anthropic')
    expect(mapVendorBrand(null, 'unknown-local-model').brand).toBe(OTHER_VENDOR_BRAND)
  })

  it('exports a vendor brand for every official roster seat', () => {
    const seats = leagueRosterVendorBrands()
    expect(seats).toHaveLength(LEAGUE_ROSTER.length)
    const byId = new Map(seats.map((seat) => [seat.model_id, seat]))
    expect(byId.get('gpt-6-astra')?.vendorBrand).toBe('OpenAI')
    expect(byId.get('muse-spark-1.2')?.vendorBrand).toBe('Meta')
    expect(byId.get('qwen3.8-max')?.vendorBrand).toBe('Alibaba/Qwen')
    expect(byId.get('kimi-k3')?.vendorBrand).toBe('Moonshot')
    expect(byId.get('glm-5.3')?.vendorBrand).toBe('Zhipu/GLM')
    expect(byId.get('hcx-007')?.vendorBrand).toBe('NAVER')
    expect(byId.get('inkling')?.vendorBrand).toBe(OTHER_VENDOR_BRAND)
    expect(byId.get('sonar-reasoning-pro')?.vendorBrand).toBe(OTHER_VENDOR_BRAND)
    expect(byId.get('youcom-research')?.vendorBrand).toBe(OTHER_VENDOR_BRAND)
  })
})

describe('brandRanking', () => {
  it('orders brands by their best model rank and breaks ties by brand name', () => {
    const ranked = brandRanking('lmarena', 'text', 'overall', '2026-10-02', [
      row({ brand: 'OpenAI', model: 'gpt-b', rank: 5 }),
      row({ brand: 'OpenAI', model: 'gpt-a', rank: 2 }),
      row({ brand: 'Google', model: 'gem-a', rank: 1 }),
      row({ brand: 'Anthropic', model: 'claude', rank: 2 }),
      row({ brand: 'Meta', model: 'llama', rank: 2 }),
      row({ source: 'lmarena', arena: 'vision', category: 'overall', publish_date: '2026-10-02', brand: 'xAI', model: 'grok', rank: 1 }),
    ])
    expect(ranked.map((item) => `${item.brand}:${item.model}:${item.rank}`)).toEqual([
      'Google:gem-a:1',
      'Anthropic:claude:2',
      'Meta:llama:2',
      'OpenAI:gpt-a:2',
    ])
  })

  it('keeps the earlier model name when one brand ties on rank', () => {
    const ranked = brandRanking('lmarena', 'text', 'overall', '2026-10-02', [
      row({ brand: 'OpenAI', model: 'gpt-z', rank: 3 }),
      row({ brand: 'OpenAI', model: 'gpt-a', rank: 3 }),
    ])
    expect(ranked).toEqual([{ brand: 'OpenAI', model: 'gpt-a', rank: 3, score: null }])
  })
})

describe('dry-run makes no network calls', () => {
  it('default argv is dry-run and never fetches', async () => {
    expect(parseAiLeaderboardBackfillArgs([]).apply).toBe(false)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const fetchJson = vi.fn(async () => {
      throw new Error('fetchJson must not run in dry-run')
    })
    const listArenas = vi.fn(async () => {
      throw new Error('listArenas must not run in dry-run')
    })
    const upsertRows = vi.fn(async () => {
      throw new Error('upsert must not run in dry-run')
    })
    const lines: string[] = []
    await runAiLeaderboardBackfill([], {
      now: () => new Date('2026-10-04T03:00:00.000Z'),
      log: (message) => lines.push(message),
      fetchJson,
      listArenas,
      upsertRows,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fetchJson).not.toHaveBeenCalled()
    expect(listArenas).not.toHaveBeenCalled()
    expect(upsertRows).not.toHaveBeenCalled()
    expect(lines[0]).toContain('dry-run')
    expect(lines[0]).toContain('No request sent')
    expect(lines[0]).toContain('2026-04-04')
    expect(planAiLeaderboardIngest(new Date('2026-10-04T03:00:00.000Z')).sinceDate).toBe('2026-04-04')
    vi.unstubAllGlobals()
  })
})

describe('ingest idempotency on fixtures', () => {
  it('upserts the same composite key twice without duplicating', async () => {
    const store = new Map<string, AiLeaderboardRow>()
    const fixture = [
      {
        model_name: 'gpt-6-astra',
        organization: 'openai',
        category: 'overall',
        leaderboard_publish_date: '2026-10-02',
        rank: 4,
        rating: 0.12,
        vote_count: 100,
      },
      {
        model_name: 'claude-fable-5.1-max',
        organization: 'anthropic',
        category: 'overall',
        leaderboard_publish_date: '2026-10-02',
        rank: 1,
        rating: 0.14,
        vote_count: 200,
      },
    ]
    const io = {
      now: () => new Date('2026-10-04T03:00:00.000Z'),
      log: () => {},
      listArenas: async () => ['text', 'webdev'],
      fetchPage: async (page: { config: string; offset: number }) => {
        if (page.config !== 'text' || page.offset > 0) return []
        return fixture
      },
      upsertRows: async (rows: AiLeaderboardRow[]) => {
        for (const item of rows) {
          store.set(`${item.source}|${item.arena}|${item.category}|${item.publish_date}|${item.model}`, item)
        }
      },
    }
    const first = await ingestAiLeaderboard({ split: 'latest', io })
    const second = await ingestAiLeaderboard({ split: 'latest', io })
    expect(first.upserted).toBe(2)
    expect(second.upserted).toBe(2)
    expect(store.size).toBe(2)
    expect(first.unmappedOrganizations).toEqual([])
    expect([...store.keys()].sort()).toEqual([
      'lmarena|text|overall|2026-10-02|claude-fable-5.1-max',
      'lmarena|text|overall|2026-10-02|gpt-6-astra',
    ])
  })

  it('maps a fixture row onto the table shape', () => {
    const mapped = mapLmarenaRow(
      'text',
      {
        model_name: 'kimi-k3-max',
        organization: 'moonshot',
        category: 'korean',
        leaderboard_publish_date: '2026-10-02 00:00:00',
        rank: 14,
        rating: 0.04,
        vote_count: 132505,
      },
      '2026-10-04T03:00:00.000Z',
    )
    expect(mapped).toMatchObject({
      source: 'lmarena',
      arena: 'text',
      category: 'korean',
      publish_date: '2026-10-02',
      model: 'kimi-k3-max',
      organization: 'moonshot',
      brand: 'Moonshot',
      rank: 14,
      score: 0.04,
      votes: 132505,
    })
  })
})

describe('daily refresh', () => {
  it('skips when a fetch already landed today', async () => {
    const now = new Date('2026-10-04T15:00:00.000Z')
    expect(alreadyRefreshedToday(now, '2026-10-04T01:00:00.000Z')).toBe(true)
    expect(alreadyRefreshedToday(now, '2026-10-03T23:00:00.000Z')).toBe(false)
    const listArenas = vi.fn(async () => ['text'])
    const result = await refreshAiLeaderboardDaily({
      now: () => now,
      lastFetchedAt: async () => '2026-10-04T01:11:00.000Z',
      listArenas,
      log: () => {},
    })
    expect(result).toEqual({ action: 'skip', reason: 'already_today' })
    expect(listArenas).not.toHaveBeenCalled()
  })

  it('wires the once-per-day step into league-generate', () => {
    const cron = readFileSync(join(ROOT, 'app/api/cron/league-generate/route.ts'), 'utf8')
    expect(cron).toContain('refreshAiLeaderboardDaily')
  })
})
