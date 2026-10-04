import fs from 'node:fs'
import path from 'node:path'
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
  cacheKeyForUrl,
  createRateLimitedFetch,
  downloadParquetFileWithCache,
  ingestAiLeaderboard,
  LMARENA_ATTRIBUTION,
  LMARENA_HAS_KOREAN_CATEGORY,
  LMARENA_LICENSE,
  LMARENA_TEXT_CATEGORIES,
  mapLmarenaRow,
  parseParquetRows,
  parseRetryAfter,
  planAiLeaderboardIngest,
  refreshAiLeaderboardDaily,
  type AiLeaderboardRow,
} from '../ingest'
import {
  parseAiLeaderboardBackfillArgs,
  runAiLeaderboardBackfill,
} from '../../../../scripts/league/ai-leaderboard-backfill'

const ROOT = path.join(__dirname, '../../../..')
const FIXTURE_PARQUET = path.join(__dirname, 'fixtures/sample.parquet')

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

describe('vendor brand mapping (including additions)', () => {
  it('maps known organizations including Baidu, StepFun, Meituan, Ant Group, IBM, AllenAI, Thinking Machines', () => {
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

    // Added brands
    expect(mapVendorBrand('baidu', 'ernie-5.0').brand).toBe('Baidu')
    expect(mapVendorBrand('stepfun', 'Step 5 Preview').brand).toBe('StepFun')
    expect(mapVendorBrand('step fun', 'step-3').brand).toBe('StepFun')
    expect(mapVendorBrand('meituan', 'longcat-flash-chat').brand).toBe('Meituan')
    expect(mapVendorBrand('ant-group', 'ling-flash-2.0').brand).toBe('Ant Group')
    expect(mapVendorBrand('ant group', 'ring-flash-2.0').brand).toBe('Ant Group')
    expect(mapVendorBrand('ibm', 'granite-4.2-8b').brand).toBe('IBM')
    expect(mapVendorBrand('allenai', 'olmo-3.1-32b-think').brand).toBe('AllenAI')
    expect(mapVendorBrand('ai2', 'tulu-3-70b').brand).toBe('AllenAI')
    expect(mapVendorBrand('allenai/uw', 'olmo-2').brand).toBe('AllenAI')
    expect(mapVendorBrand('thinky', 'inkling').brand).toBe('Thinking Machines')
    expect(mapVendorBrand('thinking machines', 'inkling').brand).toBe('Thinking Machines')

    // Unmapped orgs are reported, not guessed
    const unmapped = mapVendorBrand('somelab-ai', 'lab-model')
    expect(unmapped.brand).toBe(OTHER_VENDOR_BRAND)
    expect(unmapped.unmappedOrganization).toBe('somelab-ai')

    // Empty org falls back to model name heuristics
    expect(mapVendorBrand(null, 'ernie-4.5').brand).toBe('Baidu')
    expect(mapVendorBrand('', 'step-3').brand).toBe('StepFun')
    expect(mapVendorBrand(null, 'longcat-flash').brand).toBe('Meituan')
    expect(mapVendorBrand(null, 'granite-3.0').brand).toBe('IBM')
    expect(mapVendorBrand(null, 'olmo-7b').brand).toBe('AllenAI')
    expect(mapVendorBrand(null, 'inkling-small').brand).toBe('Thinking Machines')
    expect(mapVendorBrand(null, 'unknown-model-xyz').brand).toBe(OTHER_VENDOR_BRAND)
  })

  it('exports a vendor brand for every official roster seat and maps Thinking Machines seat', () => {
    const seats = leagueRosterVendorBrands()
    expect(seats).toHaveLength(LEAGUE_ROSTER.length)
    const byId = new Map(seats.map((seat) => [seat.model_id, seat]))
    expect(byId.get('gpt-6-astra')?.vendorBrand).toBe('OpenAI')
    expect(byId.get('muse-spark-1.2')?.vendorBrand).toBe('Meta')
    expect(byId.get('qwen3.8-max')?.vendorBrand).toBe('Alibaba/Qwen')
    expect(byId.get('kimi-k3')?.vendorBrand).toBe('Moonshot')
    expect(byId.get('glm-5.3')?.vendorBrand).toBe('Zhipu/GLM')
    expect(byId.get('hcx-007')?.vendorBrand).toBe('NAVER')
    expect(byId.get('inkling')?.vendorBrand).toBe('Thinking Machines')
    expect(byId.get('sonar-reasoning-pro')?.vendorBrand).toBe(OTHER_VENDOR_BRAND)
    expect(byId.get('youcom-research')?.vendorBrand).toBe(OTHER_VENDOR_BRAND)
  })
})

describe('parquet parsing on a small fixture file', () => {
  it('parses local parquet fixture rows via hyparquet without native build', async () => {
    expect(fs.existsSync(FIXTURE_PARQUET)).toBe(true)
    const buf = fs.readFileSync(FIXTURE_PARQUET)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

    const rows = await parseParquetRows(arrayBuf)
    expect(rows.length).toBeGreaterThan(0)
    const first = rows[0]
    expect(first).toHaveProperty('model_name')
    expect(first).toHaveProperty('organization')
    expect(first).toHaveProperty('rank')
    expect(first).toHaveProperty('category')
    expect(first).toHaveProperty('leaderboard_publish_date')

    const mapped = mapLmarenaRow('search', first, '2026-10-04T00:00:00.000Z')
    expect(mapped).not.toBeNull()
    expect(typeof mapped?.rank).toBe('number')
    expect(mapped?.arena).toBe('search')
    expect(mapped?.category).toBe('overall')
  })
})

describe('date-window filter', () => {
  it('filters rows outside the requested date window after parsing', async () => {
    const rawRows = [
      {
        model_name: 'model-early',
        organization: 'openai',
        category: 'overall',
        leaderboard_publish_date: '2026-04-01',
        rank: 1,
        rating: 1200,
        vote_count: 50,
      },
      {
        model_name: 'model-in-window',
        organization: 'anthropic',
        category: 'overall',
        leaderboard_publish_date: '2026-06-15',
        rank: 2,
        rating: 1210,
        vote_count: 60,
      },
      {
        model_name: 'model-late',
        organization: 'google',
        category: 'overall',
        leaderboard_publish_date: '2026-10-10',
        rank: 3,
        rating: 1220,
        vote_count: 70,
      },
    ]

    const upsertedRows: AiLeaderboardRow[] = []
    const io = {
      now: () => new Date('2026-10-04T00:00:00.000Z'),
      listParquetFiles: async () => ({ text: { full: ['https://example.com/text.parquet'] } }),
      downloadParquetFile: async () => ({
        buffer: new ArrayBuffer(0),
        cacheHit: false,
      }),
      parseParquetRows: async () => rawRows,
      upsertRows: async (rows: AiLeaderboardRow[]) => {
        upsertedRows.push(...rows)
      },
      log: () => {},
    }

    const report = await ingestAiLeaderboard({
      arenas: ['text'],
      split: 'full',
      sinceDate: '2026-05-01',
      untilDate: '2026-09-01',
      io,
    })
    expect(upsertedRows).toHaveLength(1)
    expect(upsertedRows[0].model).toBe('model-in-window')
    expect(upsertedRows[0].publish_date).toBe('2026-06-15')
    expect(report.skipped).toBe(2)
  })
})

describe('cache hit skips download', () => {
  it('skips GET request when remote ETag matches cached meta', async () => {
    const tmpDir = path.join(ROOT, 'node_modules/.tmp-hf-cache-test')
    fs.mkdirSync(tmpDir, { recursive: true })
    const url = 'https://huggingface.co/mock/0.parquet'
    const key = cacheKeyForUrl(url)
    const parquetFile = path.join(tmpDir, `${key}.parquet`)
    const metaFile = path.join(tmpDir, `${key}.meta.json`)

    const mockContent = Buffer.from('cached-parquet-bytes')
    fs.writeFileSync(parquetFile, mockContent)
    fs.writeFileSync(
      metaFile,
      JSON.stringify({ url, etag: '"etag-abc"', lastModified: 'Fri, 02 Oct 2026', cachedAt: '2026-10-02' }),
    )

    const getSpy = vi.fn()
    const headSpy = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { etag: '"etag-abc"', 'last-modified': 'Fri, 02 Oct 2026' },
      }),
    )

    const mockFetch = async (_u: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return headSpy()
      getSpy()
      return new Response('fresh-bytes', { status: 200, headers: { etag: '"etag-new"' } })
    }

    const res = await downloadParquetFileWithCache(url, mockFetch as any, { cacheDir: tmpDir })
    expect(res.cacheHit).toBe(true)
    expect(Buffer.from(res.buffer).toString()).toBe('cached-parquet-bytes')
    expect(headSpy).toHaveBeenCalledTimes(1)
    expect(getSpy).not.toHaveBeenCalled()

    // When etag changes, GET is executed and cache updated
    headSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { etag: '"etag-updated"' },
      }),
    )

    const res2 = await downloadParquetFileWithCache(url, mockFetch as any, { cacheDir: tmpDir })
    expect(res2.cacheHit).toBe(false)
    expect(Buffer.from(res2.buffer).toString()).toBe('fresh-bytes')
    expect(getSpy).toHaveBeenCalledTimes(1)

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('backoff schedule and Retry-After handling', () => {
  it('parses Retry-After header with seconds or HTTP date', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter('10')).toBe(10_000)
    expect(parseRetryAfter('0')).toBe(0)

    const now = 1700000000000
    const httpDate = new Date(now + 25000).toUTCString()
    expect(parseRetryAfter(httpDate, now)).toBe(25_000)
  })

  it('retries on 429/5xx with exponential backoff and honors Retry-After', async () => {
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
    }

    let calls = 0
    const mockFetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return new Response('busy', { status: 429, headers: { 'retry-after': '5' } })
      }
      if (calls === 2) {
        return new Response('error', { status: 503 })
      }
      if (calls === 3) {
        return new Response('gateway timeout', { status: 504 })
      }
      return new Response('ok', { status: 200 })
    })

    const fetchWithBackoff = createRateLimitedFetch({
      fetch: mockFetch as any,
      sleep,
      minGapMs: 0,
      backoffDelays: [2000, 4000, 8000, 16000],
    })

    const res = await fetchWithBackoff('https://example.com/data')
    expect(res.status).toBe(200)
    expect(calls).toBe(4)
    // 1st retry: Retry-After is 5s (5000ms), max(5000, 2000) = 5000
    // 2nd retry: 4000ms
    // 3rd retry: 8000ms
    expect(sleeps).toEqual([5000, 4000, 8000])
  })

  it('fails after max 5 attempts on persistent 429', async () => {
    const sleep = async () => {}
    const mockFetch = vi.fn(async () => new Response('rate limited', { status: 429 }))

    const fetchWithBackoff = createRateLimitedFetch({
      fetch: mockFetch as any,
      sleep,
      minGapMs: 0,
      maxTries: 5,
    })

    await expect(fetchWithBackoff('https://example.com/busy')).rejects.toThrow(/HTTP 429 after 5 attempts/)
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('sends HF_TOKEN as Bearer token when present and omits when not', async () => {
    let sentHeaders: Headers | undefined
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers)
      return new Response('ok', { status: 200 })
    })

    const fetchWithToken = createRateLimitedFetch({
      fetch: mockFetch as any,
      getHfToken: () => 'hf_test_secret_token_123',
      minGapMs: 0,
    })
    await fetchWithToken('https://example.com/token-check')
    expect(sentHeaders?.get('Authorization')).toBe('Bearer hf_test_secret_token_123')

    const fetchWithoutToken = createRateLimitedFetch({
      fetch: mockFetch as any,
      getHfToken: () => undefined,
      minGapMs: 0,
    })
    await fetchWithoutToken('https://example.com/no-token-check')
    expect(sentHeaders?.get('Authorization')).toBeNull()
  })

  it('enforces sequential request gap (at most one request per second)', async () => {
    const sleeps: number[] = []
    let currentTime = 1000
    const now = () => new Date(currentTime)
    const sleep = async (ms: number) => {
      sleeps.push(ms)
      currentTime += ms
    }

    const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }))
    const fetchThrottled = createRateLimitedFetch({
      fetch: mockFetch as any,
      sleep,
      now,
      minGapMs: 1000,
    })

    await fetchThrottled('https://example.com/req1')
    currentTime += 200 // Only 200ms elapsed
    await fetchThrottled('https://example.com/req2')

    expect(sleeps).toEqual([800])
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

describe('dry-run makes no network calls and prints planned files', () => {
  it('default argv is dry-run and prints planned parquet files', async () => {
    expect(parseAiLeaderboardBackfillArgs([]).apply).toBe(false)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const listParquetFiles = vi.fn(async () => {
      throw new Error('listParquetFiles must not run in dry-run')
    })
    const downloadParquetFile = vi.fn(async () => {
      throw new Error('download must not run in dry-run')
    })
    const upsertRows = vi.fn(async () => {
      throw new Error('upsert must not run in dry-run')
    })
    const lines: string[] = []
    await runAiLeaderboardBackfill([], {
      now: () => new Date('2026-10-04T03:00:00.000Z'),
      log: (message) => lines.push(message),
      listParquetFiles,
      downloadParquetFile,
      upsertRows,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(listParquetFiles).not.toHaveBeenCalled()
    expect(downloadParquetFile).not.toHaveBeenCalled()
    expect(upsertRows).not.toHaveBeenCalled()
    expect(lines[0]).toContain('dry-run')
    expect(lines[0]).toContain('No request sent')
    expect(lines[0]).toContain('2026-04-04')
    expect(lines[0]).toContain('Planned parquet files:')
    expect(lines[0]).toContain('text/full/0.parquet')
    expect(lines[0]).toContain('webdev/full/0.parquet')
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
      listParquetFiles: async () => ({ text: { latest: ['https://example.com/text.parquet'] } }),
      downloadParquetFile: async () => ({ buffer: new ArrayBuffer(0), cacheHit: false }),
      parseParquetRows: async () => fixture,
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
})

describe('daily refresh in cron', () => {
  it('skips when a fetch already landed today', async () => {
    const now = new Date('2026-10-04T15:00:00.000Z')
    expect(alreadyRefreshedToday(now, '2026-10-04T01:00:00.000Z')).toBe(true)
    expect(alreadyRefreshedToday(now, '2026-10-03T23:00:00.000Z')).toBe(false)
    const listParquetFiles = vi.fn(async () => ({}))
    const result = await refreshAiLeaderboardDaily({
      now: () => now,
      lastFetchedAt: async () => '2026-10-04T01:11:00.000Z',
      listParquetFiles,
      log: () => {},
    })
    expect(result).toEqual({ action: 'skip', reason: 'already_today' })
    expect(listParquetFiles).not.toHaveBeenCalled()
  })

  it('wires the once-per-day step into league-generate', () => {
    const cron = fs.readFileSync(path.join(ROOT, 'app/api/cron/league-generate/route.ts'), 'utf8')
    expect(cron).toContain('refreshAiLeaderboardDaily')
  })
})
