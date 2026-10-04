import { describe, expect, it } from 'vitest'
import { assertApprovedCopy } from '../../compliance'
import { subjectOutcomeFamily, sideLabelsFor } from '../../side-labels'
import { LEAGUE_LOCALES } from '../../i18n/locales'
import { getLeagueUiPack } from '../../i18n/dictionary'
import { createTechAdapter } from '../adapters/tech'
import {
  TECH_PROPOSITION_TEMPLATE_EN,
  TECH_PROPOSITION_TEMPLATE_KO,
  formatTechProposition,
  fieldsFromCatalog,
} from '../adapters/tech-compose'
import {
  assembleTechInjection,
  formatSameClassOfficialPostsLine,
  sourceFinding,
  TECH_PACKET_FRESH_COST_USD,
} from '../adapters/tech-packet'
import { encodeTechInstrument } from '../adapters/tech-catalog'
import { refusalMessageForKey } from '../refusal-copy'
import { gradePlanFor } from '../grade-plan'
import type { NormalizeSlots } from '../types'
import type { TechResearchPacket } from '../adapters/tech-packet'

const DEAD_IO = {
  getResearchPacket: async () => {
    throw new Error('io must not be called')
  },
}

const adapter = createTechAdapter(DEAD_IO)

function slots(over: Partial<NormalizeSlots> = {}): NormalizeSlots {
  const { slots: extra, ...rest } = over
  return {
    category_id: 'tech',
    entity_id: 'AAPL',
    entity_kind: 'company',
    entity_label: 'Apple',
    horizon: '1m',
    resolve_by: '2026-09-30',
    proposition_kind: 'binary_subject_outcome',
    confidence: 1,
    ...rest,
    slots: {
      claim_kind: 'product_launch',
      object_id: 'foldable_iphone',
      artifact_id: 'product_page',
      venue_id: 'official_newsroom',
      resolve_by: '2026-09-30',
      ...(extra ?? {}),
    },
  }
}

const EXAMPLES = [
  {
    companyId: 'AAPL',
    objectId: 'foldable_iphone',
    artifact: 'product_page',
    venue: 'official_newsroom',
    date: '2026-09-30',
  },
  {
    companyId: 'SAMSUNG',
    objectId: 'galaxy_s26',
    artifact: 'product_page',
    venue: 'official_newsroom',
    date: '2026-10-15',
  },
  {
    companyId: 'MSFT',
    objectId: 'copilot_pc_hardware',
    artifact: 'product_page',
    venue: 'official_newsroom',
    date: '2026-11-01',
  },
  {
    companyId: 'NVDA',
    objectId: 'rubin_gpu',
    artifact: 'pricing_page',
    venue: 'official_newsroom',
    date: '2026-12-31',
  },
  {
    companyId: 'META',
    objectId: 'meta_cfo_departure',
    artifact: 'form_8k',
    venue: 'investor_relations',
    date: '2026-09-20',
  },
] as const

const OPEN_NOW = new Date('2026-10-04T03:00:00.000Z')
const openAdapter = createTechAdapter(DEAD_IO, () => OPEN_NOW)

describe('tech adapter — open-world resolution', () => {
  it('resolves a Korean company outside the old 7-name requirement', async () => {
    const r = await openAdapter.resolveEntity('엔비디아가 이번 달 안에 새 GPU를 발표할까?', 'ko')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected a resolution')
    expect(r.label).toBe('엔비디아')
    expect(r.entity_id).toMatch(/^TECH:OPEN:nvidia:announce:/)
    expect(r.entity_id).toContain('20261031')
    expect(r.entity_kind).toBe('company')
    const composed = openAdapter.composeProposition(
      slots({ entity_id: r.entity_id, entity_label: r.label, horizon: null }),
      OPEN_NOW,
    )
    expect(composed.proposition_kind).toBe('binary_subject_outcome')
    expect(composed.observation_shape).toBe('occurrence')
    expect(composed.proposition_text).toContain('엔비디아')
    expect(composed.proposition_text).toContain('2026-10-31')
    expect(composed.resolution_rule).toMatch(/official newsroom|company blog/)
    expect(composed.proposition_text).not.toMatch(/주가|순위/)
  })

  it('resolves an English company that was never in the catalog', async () => {
    const r = await openAdapter.resolveEntity('Will SpaceX launch Starship again before Nov 1?', 'en')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected a resolution')
    expect(r.label).toBe('SpaceX')
    expect(r.entity_id).toMatch(/^TECH:OPEN:spacex:launch:starship:20261031:official_newsroom$/)
    const composed = openAdapter.composeProposition(
      slots({ entity_id: r.entity_id, entity_label: r.label }),
      OPEN_NOW,
    )
    expect(composed.proposition_text).toBe('Will SpaceX launch starship by 2026-10-31?')
    expect(composed.horizon).toBe('1m')
    expect(composed.observation_shape).toBe('occurrence')
  })

  it('refuses rumor, subjective, price, rankings, far deadlines, and resolved events', async () => {
    const cases: Array<[string, string]> = [
      ['애플 폴더블은 루머일 뿐일까?', 'rumor_only'],
      ['아이폰이 혁신적일까?', 'subjective_claim'],
      ['엔비디아 주가가 오를까?', 'price_or_earnings'],
      ['삼성이 2027년 6월에 폴더블을 출시할까?', 'deadline_too_far'],
      ['애플이 2024년 9월에 아이폰을 발표했을까?', 'already_resolved'],
    ]
    for (const [text, code] of cases) {
      const r = await openAdapter.resolveEntity(text, 'ko')
      expect(r.ok, text).toBe(false)
      if (r.ok || !('refuse' in r)) throw new Error(`expected refusal for ${text}`)
      expect(r.refuse.code, text).toBe(code)
      const ko = refusalMessageForKey(r.refuse.message_i18n_key, 'ko')
      expect(ko).toMatch(/[\uAC00-\uD7A3]/)
      assertApprovedCopy(ko)
    }
    expect(refusalMessageForKey('league.gateway.refusal.price_or_earnings', 'ko')).toContain('주식')
    expect(refusalMessageForKey('league.gateway.refusal.airank_min_horizon', 'ko')).toContain('AI 순위')
  })

  it('routes ranking questions to AIRANK and leaves tech events on TECH:OPEN', async () => {
    const ranking = await openAdapter.resolveEntity('GPT가 이번 달 LMArena 1위일까?', 'ko')
    expect(ranking.ok).toBe(true)
    if (!ranking.ok) throw new Error('expected AIRANK')
    expect(ranking.entity_id).toMatch(/^AIRANK:text:overall:brand_rank1:OpenAI:20261031$/)
    const composed = openAdapter.composeProposition(
      slots({ entity_id: ranking.entity_id, entity_label: ranking.label, slots: { locale: 'ko' } }),
      OPEN_NOW,
    )
    expect(composed.category).toBe('ai_models')
    expect(composed.horizon).toBe('1m')
    expect(composed.proposition_text).toContain('이후 처음 발표되는 LMArena')
    expect(openAdapter.gradeSources(slots({ entity_id: ranking.entity_id }))[0]).toEqual({
      tier: 1,
      kind: 'official_api',
      endpoint: 'lmarena:leaderboard',
    })

    const tech = await openAdapter.resolveEntity('스페이스엑스가 이번 달 스타십을 발사할까?', 'ko')
    expect(tech.ok).toBe(true)
    if (!tech.ok) throw new Error('expected tech')
    expect(tech.entity_id).toMatch(/^TECH:OPEN:/)
  })
})

describe('tech adapter — decidability and the stocks-chip boundary', () => {
  it('is decidable only with company + catalog claim + artifact + venue + date', () => {
    expect(adapter.isDecidable(slots())).toBe(true)
    expect(adapter.isDecidable(slots({ resolve_by: null, slots: { resolve_by: '' } }))).toBe(false)
    expect(adapter.isDecidable(slots({ slots: { object_id: 'not-a-real-object' } }))).toBe(false)
  })

  it('a price or earnings claim_kind is never decidable', () => {
    for (const kind of ['stock_price', 'close_higher', 'earnings', 'eps']) {
      expect(adapter.isDecidable(slots({ slots: { claim_kind: kind } }))).toBe(false)
    }
  })

  it('composeProposition throws on a price/earnings claim — it cannot invent a close', () => {
    expect(() => adapter.composeProposition(slots({ slots: { claim_kind: 'earnings' } }))).toThrow(
      /price\/earnings/,
    )
  })
})

describe('tech adapter — composeProposition template + 5 examples', () => {
  const NOW = new Date('2026-09-07T00:00:00.000Z')

  it('documents the EN/KO templates', () => {
    expect(TECH_PROPOSITION_TEMPLATE_EN).toBe(
      'Will {company} publish a {artifact} for {object} on its {venue} by {date}?',
    )
    expect(TECH_PROPOSITION_TEMPLATE_KO).toBe(
      '{company}, {date}까지 {venue}에 {object}에 대한 {artifact}를 공개할까?',
    )
  })

  it('renders five catalog claims in English and Korean — each checkable from one link', () => {
    const rendered: { en: string; ko: string }[] = []
    for (const ex of EXAMPLES) {
      const fields = fieldsFromCatalog(ex)
      expect(fields, ex.objectId).not.toBeNull()
      const s = slots({
        entity_id: ex.companyId,
        resolve_by: ex.date,
        slots: {
          claim_kind: fields!.object.claimKind,
          object_id: ex.objectId,
          artifact_id: ex.artifact,
          venue_id: ex.venue,
          resolve_by: ex.date,
        },
      })
      const composed = adapter.composeProposition(s, NOW)
      const en = formatTechProposition(fields!, 'en')
      const ko = formatTechProposition(fields!, 'ko')
      rendered.push({ en, ko })
      expect(composed.proposition_text).toBe(en)
      expect(composed.proposition_kind).toBe('binary_subject_outcome')
      expect(composed.observation_shape).toBe('occurrence')
      expect(composed.category).toBe('tech')
      expect(composed.instrument).toBe(
        encodeTechInstrument(ex.companyId, fields!.object.claimKind, ex.objectId),
      )
      expect(composed.proposition_text).toMatch(/publish a .+ on its .+ by \d{4}-\d{2}-\d{2}\?/)
      expect(composed.proposition_text).not.toMatch(/close higher|earnings|EPS|주가|실적/i)
      expect(ko).toMatch(/공개할까\?/)
      expect(composed.subject_label).toBe(fields!.company.label_en)
    }
    expect(rendered).toHaveLength(5)
    expect(rendered[0].en).toBe(
      'Will Apple publish a product page for a foldable iPhone on its official newsroom by 2026-09-30?',
    )
    expect(rendered[0].ko).toBe(
      '애플, 2026-09-30까지 공식 뉴스룸에 폴더블 아이폰에 대한 제품 페이지를 공개할까?',
    )
  })

  it('cannot compose a vague "announces a foldable" — missing artifact/venue/date fail isDecidable', () => {
    expect(adapter.isDecidable(slots({ slots: { artifact_id: '', venue_id: '' } }))).toBe(false)
    expect(adapter.clarifyingQuestions(slots({ slots: { artifact_id: '', venue_id: '' } })).map((q) => q.slot)).toEqual(
      expect.arrayContaining(['artifact_id', 'venue_id']),
    )
  })
})

describe('tech adapter — side pair, grade ladder, refusals', () => {
  it('maps tech onto the achieved yes/no pair in all 8 locales (pt is Portuguese)', () => {
    expect(adapter.observation_shape).toBe('occurrence')
    expect(subjectOutcomeFamily('tech')).toBe('achieved')
    for (const locale of LEAGUE_LOCALES) {
      const labels = sideLabelsFor(
        { proposition_kind: 'binary_subject_outcome', subject_label: 'Apple', category: 'tech' },
        getLeagueUiPack(locale),
      )
      expect(labels.sides).toEqual(['yes', 'no'])
      expect(labels.badge('yes').length).toBeGreaterThan(0)
      expect(labels.badge('no').length).toBeGreaterThan(0)
    }
    expect(getLeagueUiPack('pt').sides.subjectOutcome.achieved.badge.yes).toBe('Consegue')
    expect(getLeagueUiPack('en').sides.subjectOutcome.achieved.badge.yes).toBe('Achieves it')
  })

  it('gradeSources: perplexity (url) → perplexity → operator_manual; plan is operator_manual', () => {
    const [t1, t2, t3] = adapter.gradeSources(slots())
    expect(t1).toEqual({ tier: 1, kind: 'perplexity_sourced', require_url: true })
    expect(t2).toEqual({ tier: 2, kind: 'perplexity_sourced', require_url: true })
    expect(t3).toEqual({ tier: 3, kind: 'operator_manual', require_url: true })
    expect(gradePlanFor(adapter, 'TECH:AAPL:product_launch:foldable_iphone')).toEqual({
      source: 'operator_manual',
    })
  })

  it('every declared refusal code has Korean copy that passes compliance', () => {
    const taxonomy = adapter.refusalTaxonomy()
    expect(taxonomy.map((t) => t.code)).toEqual([
      'vague_claim',
      'rumor_only',
      'subjective_claim',
      'price_or_earnings',
      'unsupported_field',
      'airank_min_horizon',
      'deadline_too_far',
      'already_resolved',
      'missing_slot',
      'ungradeable',
      'jurisdiction_blocked',
      'low_confidence',
    ])
    for (const entry of taxonomy) {
      const ko = refusalMessageForKey(entry.message_i18n_key, 'ko')
      const en = refusalMessageForKey(entry.message_i18n_key, 'en')
      expect(ko.length).toBeGreaterThan(0)
      expect(en.length).toBeGreaterThan(0)
      expect(ko).toMatch(/[\uAC00-\uD7A3]/)
      assertApprovedCopy(ko)
      assertApprovedCopy(en)
    }
    expect(refusalMessageForKey('league.gateway.refusal.price_or_earnings', 'ko')).toContain('주식')
    expect(refusalMessageForKey('league.gateway.refusal.vague_claim', 'ko')).toContain('링크')
  })
})

describe('tech packet — no numeric feed, URLs required, cost reported', () => {
  it('prints FIRST OCCURRENCE instead of a 0 same-class count', () => {
    expect(formatSameClassOfficialPostsLine(0, '2026-09-01')).toBe(
      'Same-class official posts last 12 months: FIRST OCCURRENCE — NO PRIOR BASELINE (novel product class)',
    )
    expect(formatSameClassOfficialPostsLine(2, '2026-09-01')).toBe(
      'Same-class official posts last 12 months: 2 (as of 2026-09-01)',
    )
  })

  it('drops findings that lack an https URL or a date', () => {
    expect(sourceFinding('q', 'Apple said something yesterday').usable).toBe(false)
    expect(sourceFinding('q', 'See https://www.apple.com/newsroom/2026/09/foldable/ on 2026-09-12').usable).toBe(
      true,
    )
  })

  it('correctly sources findings from structured citations and natural language dates', () => {
    const finding = sourceFinding({
      query: 'Apple event September 2026',
      summary: 'Apple scheduled a keynote on September 9, 2026 at Apple Park[1].',
      citations: ['https://www.apple.com/newsroom/2026/09/special-event/'],
    })
    expect(finding.usable).toBe(true)
    expect(finding.url).toBe('https://www.apple.com/newsroom/2026/09/special-event/')
    expect(finding.date).toBe('2026-09-09')

    const findingWithSearchResults = sourceFinding({
      query: 'Mac Mini release date',
      summary: 'Mac mini announced with M4 chip.',
      searchResults: [
        {
          url: 'https://www.apple.com/newsroom/mac-mini',
          date: '2026-08-25',
          snippet: 'August 25, 2026 announcement',
        },
      ],
    })
    expect(findingWithSearchResults.usable).toBe(true)
    expect(findingWithSearchResults.url).toBe('https://www.apple.com/newsroom/mac-mini')
    expect(findingWithSearchResults.date).toBe('2026-08-25')

    // Reputable domain without a day stays usable, and the date is not invented.
    const noDate = sourceFinding({
      query: 'Apple newsroom',
      summary: 'No date mentioned anywhere in this text.',
      citations: ['https://www.apple.com/newsroom/'],
    })
    expect(noDate.usable).toBe(true)
    expect(noDate.url).toBe('https://www.apple.com/newsroom/')
    expect(noDate.date).toBeNull()

    const unknownHost = sourceFinding({
      query: 'blog',
      summary: 'A personal blog post with no date.',
      citations: ['https://random-blog.example/post'],
    })
    expect(unknownHost.usable).toBe(false)
    expect(unknownHost.date).toBeNull()

    // Missing citation/URL even with date -> dropped
    const noUrl = sourceFinding({
      query: 'Rumor',
      summary: 'Rumored for September 9, 2026 with no citation links.',
    })
    expect(noUrl.usable).toBe(false)
    expect(noUrl.url).toBeNull()
    expect(noUrl.date).toBe('2026-09-09')
  })

  it('assembles numbers-first injection with base rates and related signals', () => {
    const research: TechResearchPacket = {
      available: true,
      cached: false,
      cacheKey: 'tech-test',
      queries: ['Apple foldable newsroom'],
      findings: [
        {
          query: 'Apple foldable newsroom',
          summary: 'No product page yet. https://www.apple.com/newsroom/ 2026-09-01',
        },
        { query: 'rumor', summary: 'Someone tweeted a foldable. no url' },
      ],
      costUsd: TECH_PACKET_FRESH_COST_USD,
      tier: 'normal',
    }
    const injection = assembleTechInjection({
      round: {
        proposition_text:
          'Will Apple publish a product page for a foldable iPhone on its official newsroom by 2026-09-30?',
        category: 'tech',
        instrument: 'TECH:AAPL:product_launch:foldable_iphone',
        horizon: '1m',
        resolution_rule: 'official newsroom product page',
        resolves_at: '2026-09-30T23:59:59.999Z',
      },
      research,
    })
    expect(injection).toContain('Official posts last 12 months: 14')
    expect(injection).toContain(
      'Same-class official posts last 12 months: FIRST OCCURRENCE — NO PRIOR BASELINE (novel product class)',
    )
    expect(injection).not.toMatch(/Same-class official posts last 12 months: 0/)
    expect(injection).toContain('Samsung (foldable peer): official posts last 12m = 16')
    expect(injection).toContain('https://www.apple.com/newsroom/')
    expect(injection).toContain('Dropped (missing url, or url without a date on an unknown domain): 1')
    expect(injection).toContain('argues occurs: none measured')
    expect(injection).toContain('argues does not occur:')
    expect(injection).not.toMatch(/latestClose|Twelve Data/)
  })

  it('buildPacket spends research only — no Twelve Data credits', async () => {
    const live = createTechAdapter({
      async getResearchPacket() {
        return {
          available: true,
          cached: false,
          cacheKey: 'k',
          directorModel: null,
          queries: ['q'],
          findings: [{ query: 'q', summary: 'https://news.samsung.com/ 2026-09-02 Galaxy mention' }],
          costUsd: 0.0312,
          tier: 'normal',
        }
      },
    })
    const packet = await live.buildPacket(slots(), {
      round: {
        proposition_text: 'x',
        category: 'tech',
        instrument: 'TECH:SAMSUNG:product_launch:galaxy_s26',
        horizon: '1m',
        resolution_rule: 'r',
        resolves_at: '2026-10-15T23:59:59.999Z',
      },
      costCapUsd: 20,
    })
    expect(packet.dataPacket.available).toBe(false)
    expect(packet.relatedCreditsSpent).toBe(0)
    expect(packet.research.costUsd).toBe(0.0312)
    expect(packet.research.tier).toBe('normal')
    expect(packet.research.tierSignal).toMatch(/\$0\.03/)
  })
})

describe('tech adapter — public free-prompt category', () => {
  it('replaces macro on the hub and keeps tech freeform with no chips', async () => {
    const { PUBLIC_CATEGORY_IDS, PUBLIC_CATALOG, isFreeformSearchCategory } = await import('../../catalog')
    expect(PUBLIC_CATEGORY_IDS).toContain('tech')
    expect(PUBLIC_CATEGORY_IDS).not.toContain('macro_econ')
    expect(isFreeformSearchCategory('tech')).toBe(true)
    expect(PUBLIC_CATALOG.find((c) => c.id === 'tech')?.instruments).toEqual([])
    expect(getLeagueUiPack('ko').catalog.categories.tech).toBe('테크')
    expect(getLeagueUiPack('en').catalog.categories.tech).toBe('Tech')
    expect(getLeagueUiPack('ko').catalog.freeformPanel.tech.title).toBe('테크 · AI 순위')
    expect(getLeagueUiPack('ko').catalog.techSamples).toEqual([
      '애플이 10월 안에 새 아이패드를 발표할까?',
      '삼성이 연말까지 3단 폴더블을 출시할까?',
      '클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?',
      '중국 AI가 이번 달 종합 순위 3위 안에 들까?',
    ])
    expect(getLeagueUiPack('ko').catalog.freeformPanel.tech.body).not.toMatch(/준비 중/)
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.catalog.categories.tech.trim().length).toBeGreaterThan(0)
      expect(pack.catalog.techHint.trim().length).toBeGreaterThan(0)
      expect(pack.catalog.techSamples).toHaveLength(4)
      expect(pack.catalog.freeformPanel.tech.examples).toHaveLength(4)
      expect(pack.catalog.freeformPanel.tech.title).not.toMatch(/준비 중|Coming soon|近日公開|即將推出/)
      expect(pack.gateway.placeholder.tech.trim().length).toBeGreaterThan(0)
    }
  })

  it('keeps September-style citations that have a date or a reputable domain', () => {
    const research: TechResearchPacket = {
      available: true,
      cached: false,
      cacheKey: 'sep',
      queries: [
        'Apple foldable iPhone rumors latest news September 2026',
        'Apple Newsroom new product announcements September 2026',
        'analyst expectations Apple foldable phone release date 2026 2027',
      ],
      findings: [
        {
          query: 'Apple Newsroom',
          summary: 'Apple has not posted a foldable product page.',
          citations: ['https://www.reuters.com/technology/apple-foldable'],
        },
        {
          query: 'rumors',
          summary: 'Supply chain notes from September 9, 2026 still call the phone unannounced.',
          citations: ['https://www.theverge.com/2026/09/09/apple-foldable'],
        },
        {
          query: 'forum',
          summary: 'Someone on a forum said it ships this month.',
          citations: ['https://random-blog.example/foldable'],
        },
      ],
      costUsd: 0.016,
      tier: 'normal',
    }
    const injection = assembleTechInjection({
      round: {
        proposition_text: 'Will Apple publish a product page for a foldable iPhone by 2026-09-30?',
        category: 'tech',
        instrument: 'TECH:AAPL:product_launch:foldable_iphone',
        horizon: '1m',
        resolution_rule: 'official newsroom',
        resolves_at: '2026-09-30T23:59:59.999Z',
      },
      research,
    })
    expect(injection).toContain('https://www.reuters.com/technology/apple-foldable')
    expect(injection).toContain('date unavailable')
    expect(injection).toContain('2026-09-09')
    expect(injection).not.toContain('random-blog.example')
    expect(injection).toContain('Dropped (missing url, or url without a date on an unknown domain): 1')
    expect(injection).toContain('none measured')
    expect(injection).not.toMatch(/2026-09-01 \| https:\/\/www\.reuters\.com/)
  })
})
