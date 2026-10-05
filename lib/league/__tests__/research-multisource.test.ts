import { describe, expect, it } from 'vitest'
import {
  formatMultiSourceSection,
  mergeResearchFindings,
  parseResearchModeOutput,
  parseStatedDate,
  tierForUrl,
  type RawResearchFinding,
} from '../research-merge'
import {
  DEFAULT_RESEARCH_PROVIDERS,
  parseResearchProviderList,
  runMultiSourceResearch,
  selectResearchProviders,
  type ResearchProviderCaller,
} from '../research-providers'
import { queryPlanFromSamplePrompt, techQueryPlan, aiModelsQueryPlan, metalsQueryPlan } from '../research-query-plans'
import { assembleTechInjection, type TechResearchPacket } from '../gateway/adapters/tech-packet'
import { assembleAirankInjection } from '../ai-ranking/packet'

const DEADLINE = '2026-12-31'

function finding(partial: Partial<RawResearchFinding> & Pick<RawResearchFinding, 'provider' | 'claim'>): RawResearchFinding {
  return {
    date: null,
    url: null,
    side: 'neutral',
    rumor: false,
    ...partial,
  }
}

describe('gold_metal news query plan', () => {
  it('labels central-bank, geopolitical, and macro-calendar queries as NEWS', () => {
    const queries = metalsQueryPlan({ instrument: 'XAU/USD', deadline: '2026-10-12' })
    expect(queries).toHaveLength(3)
    expect(queries.every((q) => q.startsWith('NEWS:'))).toBe(true)
    expect(queries.join('\n')).toMatch(/central bank gold buying/)
    expect(queries.join('\n')).toMatch(/geopolitical risk/)
    expect(queries.join('\n')).toMatch(/FOMC OR CPI OR nonfarm payrolls/)
    expect(queries.join('\n')).toContain('2026-10-12')
  })
})

describe('tech / AI-release query plans', () => {
  it('builds TECH:OPEN coverage for Apple foldable', () => {
    const plan = queryPlanFromSamplePrompt('Apple foldable', DEADLINE)
    expect(plan.category).toBe('tech')
    expect(plan.subject).toBe('Apple')
    expect(plan.object).toBe('foldable')
    const blob = plan.queries.join('\n')
    expect(blob).toMatch(/CES/)
    expect(blob).toMatch(/WWDC/)
    expect(blob).toMatch(/Google I\/O/)
    expect(blob).toMatch(/Galaxy Unpacked/)
    expect(blob).toMatch(/Computex/)
    expect(blob).toMatch(/FCC ID/)
    expect(blob).toMatch(/RRA 적합성 인증/)
    expect(blob).toMatch(/TENAA/)
    expect(blob).toMatch(/Bluetooth SIG/)
    expect(blob).toMatch(/8-K/)
    expect(blob).toMatch(/DART/)
    expect(blob).toMatch(/last 5 years/)
    expect(blob).toMatch(/supply chain/)
    expect(blob).toMatch(/RUMOR/)
    expect(blob).toMatch(DEADLINE)
    expect(plan.queries.length).toBeGreaterThanOrEqual(6)
  })

  it('builds Samsung tri-fold and Nvidia GPU tech plans', () => {
    const samsung = queryPlanFromSamplePrompt('Samsung tri-fold', DEADLINE)
    expect(samsung.category).toBe('tech')
    expect(samsung.subject).toBe('Samsung')
    expect(samsung.object).toBe('tri-fold')
    expect(samsung.queries.join('\n')).toMatch(/Samsung/)
    expect(samsung.queries.join('\n')).toMatch(/tri-fold/)

    const nvidia = queryPlanFromSamplePrompt('Nvidia GPU', DEADLINE)
    expect(nvidia.category).toBe('tech')
    expect(nvidia.subject).toBe('Nvidia')
    expect(nvidia.object).toBe('GPU')
    expect(nvidia.queries.join('\n')).toMatch(/Nvidia/)
    expect(nvidia.queries.join('\n')).toMatch(/GPU/)
    expect(nvidia.queries.join('\n')).toMatch(/earnings call/)
  })

  it('builds an AI-ranking news plan for GPT-6 release', () => {
    const plan = queryPlanFromSamplePrompt('GPT-6 release', DEADLINE)
    expect(plan.category).toBe('ai_models')
    expect(plan.brands).toContain('OpenAI')
    const blob = plan.queries.join('\n')
    expect(blob).toMatch(/last 30 days/)
    expect(blob).toMatch(/OpenRouter/)
    expect(blob).toMatch(/Hugging Face/)
    expect(blob).toMatch(/LMArena/)
    expect(blob).toMatch(/unconfirmed/)
    expect(blob).toMatch(DEADLINE)
    expect(blob).toMatch(/OpenAI/)
  })

  it('keeps direct plan builders aligned with the sample helper', () => {
    expect(techQueryPlan({ subject: 'Apple', object: 'foldable', deadline: DEADLINE })).toEqual(
      queryPlanFromSamplePrompt('Apple foldable', DEADLINE).queries,
    )
    expect(aiModelsQueryPlan({ brands: ['OpenAI'], deadline: DEADLINE })).toEqual(
      queryPlanFromSamplePrompt('GPT-6 release', DEADLINE).queries,
    )
  })
})

describe('research merge / tier / disagreement', () => {
  it('de-duplicates the same fact across providers and counts agreement', () => {
    const merged = mergeResearchFindings([
      finding({
        provider: 'perplexity',
        claim: 'Apple Newsroom has no foldable product page',
        date: '2026-09-01',
        url: 'https://www.apple.com/newsroom/',
        side: 'does_not_occur',
      }),
      finding({
        provider: 'xai',
        claim: 'Apple Newsroom has no foldable product page',
        date: '2026-09-01',
        url: 'https://www.apple.com/newsroom/2026/09/',
        side: 'does_not_occur',
      }),
    ])
    expect(merged.facts).toHaveLength(1)
    expect(merged.facts[0]?.providerCount).toBe(2)
    expect(merged.facts[0]?.providers).toEqual(['perplexity', 'xai'])
    expect(merged.facts[0]?.tier).toBe('official')
    expect(merged.facts[0]?.date).toBe('2026-09-01')
  })

  it('tiers official, regulator, major outlet, rumor, and other', () => {
    expect(tierForUrl('https://www.apple.com/newsroom/')).toBe('official')
    expect(tierForUrl('https://www.sec.gov/Archives/edgar/data/1/8-k.htm')).toBe('official')
    expect(tierForUrl('https://fccid.io/BCG-E1234')).toBe('regulator')
    expect(tierForUrl('https://www.reuters.com/technology/apple-foldable')).toBe('major_outlet')
    expect(tierForUrl('https://www.macrumors.com/2026/09/09/foldable/')).toBe('rumor')
    expect(tierForUrl('https://random.blog/post')).toBe('other')
  })

  it('keeps conflicting claims side by side and labels sources disagree', () => {
    const merged = mergeResearchFindings([
      finding({
        provider: 'gemini',
        claim: 'Apple will announce a foldable iPhone at the September event',
        date: '2026-09-01',
        url: 'https://www.reuters.com/technology/apple-foldable',
        side: 'occurs',
      }),
      finding({
        provider: 'openai',
        claim: 'Apple will not announce a foldable iPhone at the September event',
        date: '2026-09-02',
        url: 'https://www.wsj.com/tech/apple-foldable',
        side: 'does_not_occur',
      }),
    ])
    expect(merged.facts).toHaveLength(2)
    expect(merged.disagreements).toHaveLength(1)
    const section = formatMultiSourceSection({
      merged,
      log: {
        providersUsed: ['gemini', 'openai'],
        providersFailed: [],
        findingsPerProvider: { gemini: 1, openai: 1 },
        mergedCount: 2,
        costUsd: 0.08,
        wallMs: 1200,
      },
    })
    expect(section).toContain('RESEARCH (MULTI-SOURCE)')
    expect(section).toMatch(/sources disagree/i)
    expect(section).toContain('argues occurs:')
    expect(section).toContain('argues does not occur:')
    expect(section).toContain('TIER major outlet')
  })

  it('never invents dates — only stated ISO / Month DD, YYYY survive', () => {
    expect(parseStatedDate('2026-09-09')).toBe('2026-09-09')
    expect(parseStatedDate('September 9, 2026')).toBe('2026-09-09')
    expect(parseStatedDate('recently')).toBeNull()
    expect(parseStatedDate('next week')).toBeNull()
    expect(parseStatedDate('2026')).toBeNull()
    expect(parseStatedDate('Q4')).toBeNull()
  })

  it('prints none measured for empty tiers and empty both-sides', () => {
    const section = formatMultiSourceSection({
      merged: { facts: [], disagreements: [] },
      log: {
        providersUsed: ['perplexity'],
        providersFailed: [],
        findingsPerProvider: { perplexity: 0 },
        mergedCount: 0,
        costUsd: 0.03,
        wallMs: 800,
      },
    })
    expect(section).toMatch(/TIER official[\s\S]*none measured/)
    expect(section).toMatch(/TIER regulator[\s\S]*none measured/)
    expect(section).toContain('argues occurs: none measured')
    expect(section).toContain('argues does not occur: none measured')
    expect(section).toContain('SOURCES DISAGREE')
    expect(section).toContain('none measured')
  })
})

describe('multi-provider RESEARCH runner', () => {
  it('skips a failed provider and still merges the rest', async () => {
    const caller: ResearchProviderCaller = async ({ provider }) => {
      if (provider === 'youcom') throw new Error('timeout')
      return {
        costUsd: 0.02,
        findings: [
          finding({
            provider,
            claim: 'FCC ID BCG-E9999 listed for a foldable chassis',
            date: '2026-08-15',
            url: 'https://fccid.io/BCG-E9999',
            side: 'occurs',
          }),
        ],
      }
    }
    const result = await runMultiSourceResearch({
      queries: techQueryPlan({ subject: 'Apple', object: 'foldable', deadline: DEADLINE }),
      proposition: 'Will Apple ship a foldable by 2026-12-31?',
      instrument: 'TECH:OPEN:apple:release:foldable:20261231:official_newsroom',
      deadline: DEADLINE,
      configured: DEFAULT_RESEARCH_PROVIDERS,
      costCapUsd: 0.15,
      caller,
    })
    expect(result.log.providersFailed).toEqual([{ provider: 'youcom', error: 'timeout' }])
    expect(result.log.providersUsed).toEqual(['perplexity', 'xai', 'gemini'])
    expect(result.merged.facts).toHaveLength(1)
    expect(result.merged.facts[0]?.providerCount).toBe(3)
    expect(result.merged.facts[0]?.tier).toBe('regulator')
    expect(result.section).toContain('youcom (timeout)')
    expect(result.section).toContain('Merged facts: 1')
  })

  it('enforces the per-packet cost cap before launch', () => {
    const tight = selectResearchProviders({
      configured: DEFAULT_RESEARCH_PROVIDERS,
      costCapUsd: 0.05,
    })
    expect(tight.selected).toEqual(['perplexity', 'gemini'])
    expect(tight.skippedForCap).toEqual(['xai', 'youcom'])

    const mid = selectResearchProviders({ configured: DEFAULT_RESEARCH_PROVIDERS, costCapUsd: 0.09 })
    expect(mid.selected).toEqual(['perplexity', 'xai', 'gemini'])
    expect(mid.skippedForCap).toEqual(['youcom'])

    const roomy = selectResearchProviders({ configured: DEFAULT_RESEARCH_PROVIDERS, costCapUsd: 0.15 })
    expect(roomy.selected).toEqual(['perplexity', 'xai', 'gemini', 'youcom'])
    expect(roomy.skippedForCap).toEqual([])
  })

  it('keeps OpenAI off the default research list; env can still add it', () => {
    expect(DEFAULT_RESEARCH_PROVIDERS).toEqual(['perplexity', 'xai', 'gemini', 'youcom'])
    expect(DEFAULT_RESEARCH_PROVIDERS).not.toContain('openai')
    expect(parseResearchProviderList('xai,gemini,youcom,openai')).toContain('openai')
  })

  it('does not launch more than Perplexity + 3 others even when the list is longer', async () => {
    const launched: string[] = []
    const caller: ResearchProviderCaller = async ({ provider }) => {
      launched.push(provider)
      return { costUsd: 0.01, findings: [] }
    }
    const picked = selectResearchProviders({
      configured: parseResearchProviderList('perplexity,xai,gemini,openai,youcom,claude'),
      costCapUsd: 1,
    })
    expect(picked.selected).toEqual(['perplexity', 'xai', 'gemini', 'openai'])
    expect(picked.skippedForCap).toEqual(['youcom', 'claude'])

    await runMultiSourceResearch({
      queries: ['q'],
      proposition: 'p',
      instrument: 'TECH:OPEN:apple:release:foldable:20261231:official_newsroom',
      deadline: DEADLINE,
      configured: picked.selected,
      costCapUsd: 1,
      caller,
    })
    expect(launched).toEqual(['perplexity', 'xai', 'gemini', 'openai'])
  })

  it('parses RESEARCH-mode JSON and ignores invented date strings', () => {
    const findings = parseResearchModeOutput({
      provider: 'gemini',
      text: JSON.stringify({
        findings: [
          {
            claim: 'No product page',
            date: '2026-09-01',
            url: 'https://www.apple.com/newsroom/',
            side: 'does_not_occur',
            rumor: false,
          },
          {
            claim: 'Leaker says 2027',
            date: 'soon',
            url: 'https://www.macrumors.com/2026/09/09/foldable/',
            side: 'occurs',
            rumor: true,
          },
        ],
      }),
    })
    expect(findings[0]?.date).toBe('2026-09-01')
    expect(findings[1]?.date).toBeNull()
    expect(findings[1]?.rumor).toBe(true)
  })
})

describe('packet injection', () => {
  it('appends RESEARCH (MULTI-SOURCE) on the tech packet without changing card-facing copy', () => {
    const research: TechResearchPacket = {
      available: true,
      cached: false,
      cacheKey: 'k',
      queries: ['Apple foldable'],
      findings: [],
      costUsd: 0.08,
      tier: 'normal',
      multiSourceBlock: 'RESEARCH (MULTI-SOURCE)\nTIER official (newsroom / filing)\n- none measured',
    }
    const injection = assembleTechInjection({
      round: {
        proposition_text: 'Will Apple publish a foldable iPhone page by 2026-12-31?',
        category: 'tech',
        instrument: 'TECH:AAPL:product_launch:foldable_iphone',
        horizon: '1m',
        resolution_rule: 'official newsroom',
        resolves_at: '2026-12-31T23:59:59.999Z',
      },
      research,
    })
    expect(injection).toContain('RESEARCH (MULTI-SOURCE)')
    expect(injection).toContain('argues occurs: none measured')
    expect(injection).not.toMatch(/latestClose|Twelve Data/)
  })

  it('appends the same section on the airank packet', () => {
    const text = assembleAirankInjection({
      parts: {
        arena: 'text',
        category: 'overall',
        kind: 'brand_rank1',
        subject: 'OpenAI',
        deadlineYmd: '2026-12-31',
      },
      horizon: '1m',
      asOfYmd: '2026-10-01',
      rankingsByDate: [],
      multiSourceBlock: 'RESEARCH (MULTI-SOURCE)\nTIER other\n- none measured',
    })
    expect(text).toContain('RESEARCH (MULTI-SOURCE)')
    expect(text).toContain('NEWS: none measured')
  })
})
