import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DivisionBoard } from '../../../components/league/DivisionBoard'
import { EQUITY_QUALITATIVE_GUIDANCE, scrubAnalystDisclosure, scrubsAnalystDisclosure } from '../analyst-disclosure'
import { EQUITY_QUALITATIVE_GUIDANCE as CONTRACT_EQUITY_LINE, systemPromptFor, answerContractFor } from '../answer-contract'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import { buildDeepSnapshot } from '../deep-snapshot'
import { buildConsensusSystemPrompt, consensusRationaleNeedsRetry, parseConsensusOutput } from '../extra/consensus'
import { buildCrowSystemPrompt } from '../extra/crow'
import { skipKoTranslationLlm } from '../rationale-display'
import { visibleLeagueText } from '../visible-disclosure'
import { getLeagueUiPack } from '../i18n/dictionary'

const ROOT = join(__dirname, '../../..')

const mocks = vi.hoisted(() => ({
  runSingleAiProvider: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ai/router', () => ({
  runSingleAiProvider: (...args: unknown[]) => mocks.runSingleAiProvider(...args),
}))

function readable(out: string | null): string {
  expect(out).toBeTruthy()
  expect(out!.trim().length).toBeGreaterThan(1)
  return out!
}

describe('equity display-layer scrub — leaked samples', () => {
  it('short-ratio spike (14.30 vs 10.28 avg) drops the raw comparison and keeps the spike', () => {
    const out = readable(scrubAnalystDisclosure('short-ratio spike (14.30 vs 10.28 avg)'))
    expect(out).not.toMatch(/14\.30|10\.28/)
    expect(out).toMatch(/short-ratio spike/i)
  })

  it('333억 KRW 규모의 기관 순매수 keeps 기관 순매수', () => {
    const out = readable(scrubAnalystDisclosure('333억 KRW 규모의 기관 순매수'))
    expect(out).not.toMatch(/333/)
    expect(out).not.toMatch(/KRW/)
    expect(out).toContain('기관 순매수')
  })

  it('1.4M 컨센서스 목표가 drops the figure and the target-consensus claim', () => {
    const out = scrubAnalystDisclosure('1.4M 컨센서스 목표가')
    expect(out ?? '').not.toMatch(/1\.4M|1\.4/)
    expect(out ?? '').not.toContain('컨센서스 목표가')
  })

  it('strips the SK스퀘어 scout and extra leaks and keeps the filing', () => {
    const leaks = [
      'DB Securities의 목표 주가 상향',
      '컨센서스 목표가',
      '목표주가 컨센서스',
      '증권사 리포트도 평균 목표가가 상향',
    ]
    for (const leak of leaks) {
      const out = readable(scrubAnalystDisclosure(`실적 가이던스가 올랐다. ${leak}. 유상증자 공시는 유지.`))
      expect(out, leak).not.toContain('DB Securities')
      expect(out, leak).not.toContain('컨센서스 목표가')
      expect(out, leak).not.toContain('목표주가 컨센서스')
      expect(out, leak).not.toContain('증권사 리포트')
      expect(out, leak).not.toContain('평균 목표가')
      expect(out, leak).not.toContain('목표 주가 상향')
      expect(out, leak).toContain('유상증자')
    }
    expect(scrubAnalystDisclosure('Goldman upgrades to buy')).not.toMatch(/Goldman|upgrades to buy/i)
  })

  it('JPMorgan과 Goldman의 매도(Sell) 의견 목표가 becomes 일부 증권사', () => {
    const out = readable(scrubAnalystDisclosure('JPMorgan과 Goldman의 매도(Sell) 의견 목표가'))
    expect(out).not.toMatch(/JPMorgan|Goldman/i)
    expect(out).toContain('일부 증권사')
    expect(out).toMatch(/매도/)
  })

  it('PER ~287x drops the multiple', () => {
    const out = readable(scrubAnalystDisclosure('PER ~287x'))
    expect(out).not.toMatch(/287/)
    expect(out).toMatch(/PER/i)
  })

  it('(kr.investing.com) is removed', () => {
    const out = scrubAnalystDisclosure('상승 압력 (kr.investing.com)')
    expect(out).not.toMatch(/kr\.investing\.com/i)
    expect(out).toContain('상승 압력')
  })

  it('(stockhub.kr) is removed', () => {
    const out = scrubAnalystDisclosure('수급 과열 (stockhub.kr)')
    expect(out).not.toMatch(/stockhub\.kr/i)
    expect(out).toContain('수급 과열')
  })

  it('3분기 OP 전망치 약 70T drops 70T', () => {
    const out = readable(scrubAnalystDisclosure('3분기 OP 전망치 약 70T'))
    expect(out).not.toMatch(/70T|70/)
    expect(out).toContain('OP 전망치')
    expect(out).toContain('3분기')
  })

  it('외국인의 216.1B won KOSPI 매도세 keeps the selling, drops the amount', () => {
    const out = readable(scrubAnalystDisclosure('외국인의 216.1B won KOSPI 매도세'))
    expect(out).not.toMatch(/216\.1/)
    expect(out).not.toMatch(/\bwon\b/i)
    expect(out).toContain('외국인')
    expect(out).toContain('매도세')
  })

  it('KRX English leftover keeps the anchor close and rights-issue size, still needs Korean', () => {
    const raw = 'KRX data show a 10-02 close near 115,700 and a 1.2조 rights issue…'
    const out = readable(scrubAnalystDisclosure(raw))
    expect(out).toContain('115,700')
    expect(out).toContain('1.2조')
    expect(out).toMatch(/rights issue/i)
    expect(skipKoTranslationLlm('ko', out)).toBe(false)
    expect(skipKoTranslationLlm('ko', raw)).toBe(false)
  })

  it('net buy of 12.3bn won keeps the qualitative buy', () => {
    const out = readable(scrubAnalystDisclosure('foreign net buy of 12.3bn won'))
    expect(out).not.toMatch(/12\.3/)
    expect(out).toMatch(/net buy/i)
  })

  it('does not apply to gold_metals; does apply to stock and etf_index', () => {
    expect(scrubsAnalystDisclosure('stock')).toBe(true)
    expect(scrubsAnalystDisclosure('etf_index')).toBe(true)
    expect(scrubsAnalystDisclosure('gold_metals')).toBe(false)
    expect(visibleLeagueText('gold_metals', 'PER ~287x')).toContain('287')
    expect(visibleLeagueText('stock', 'PER ~287x')).not.toMatch(/287/)
  })
})

describe('equity display-layer scrub — whole tokens, ranges, outlets, residue', () => {
  it('does not match broker letters inside common words', () => {
    const keep = ['AMPC subsidy', 'subsidies', 'citizen', 'citation', 'Jefferson', 'goldmine', 'UBSAN', 'KB국민카드 이벤트']
    for (const sample of keep) {
      expect(scrubAnalystDisclosure(sample), sample).toBe(sample)
    }
    expect(scrubAnalystDisclosure('AMPC subsidy')).not.toContain('일부 증권사')
    expect(scrubAnalystDisclosure('AMPC subsidy')).not.toMatch(/s일부 증권사idy/)
    const citi = readable(scrubAnalystDisclosure('Citigroup cut the name'))
    expect(citi).not.toMatch(/Citigroup/i)
    expect(citi).toContain('일부 증권사')
    const nomura = readable(scrubAnalystDisclosure('nomura raised the name'))
    expect(nomura).not.toMatch(/nomura/i)
    expect(nomura).toContain('일부 증권사')
  })

  it('scrubs target ranges, % upside, outlets, markdown, and citations from today samples', () => {
    const range = readable(scrubAnalystDisclosure('애널리스트들의 낙관적인 목표가(190k-270k)가'))
    expect(range).not.toMatch(/\d/)
    expect(range).toContain('목표가')
    expect(readable(scrubAnalystDisclosure('PT 190k–270k'))).not.toMatch(/190|270/)
    expect(readable(scrubAnalystDisclosure('목표주가 19만~27만원'))).not.toMatch(/19|27/)
    expect(readable(scrubAnalystDisclosure('$190-270 target'))).not.toMatch(/190|270/)

    expect(scrubAnalystDisclosure('목표가 컨센서스가 현재가 대비 약 33% 상방')).toBeNull()
    expect(scrubAnalystDisclosure('consensus target implies 33% upside')).toBeNull()

    const mk = readable(scrubAnalystDisclosure('수급 과열 (MK 주식 시세 페이지)'))
    expect(mk).not.toMatch(/MK|시세 페이지/)
    expect(mk).toContain('수급 과열')
    for (const outlet of ['매일경제', '한국경제', '머니투데이', '이데일리', '연합뉴스', 'Reuters', 'Bloomberg', 'Yahoo Finance', 'Investing.com', 'Naver 증권']) {
      const out = readable(scrubAnalystDisclosure(`상승 ${outlet} 보도`))
      expect(out, outlet).not.toContain(outlet)
      expect(out, outlet).toContain('상승')
    }

    expect(readable(scrubAnalystDisclosure('예정된 ₩1.2조 유상증자'))).toContain('1.2조 유상증자')
    expect(scrubAnalystDisclosure('외국인의 5d 순매수')).toBe('외국인의 5d 순매수')
    expect(readable(scrubAnalystDisclosure('링크 ([](/media/release/30407 끝'))).not.toMatch(/media\/release|30407|\[\]\(/)
    expect(readable(scrubAnalystDisclosure('([](/inv/38890 과 ([](/equities/kia-motors 다음'))).not.toMatch(/inv\/38890|equities\/kia-motors/)
    expect(readable(scrubAnalystDisclosure('메모 [](…) 남김'))).not.toMatch(/\[\]\(|…/)
    expect(readable(scrubAnalystDisclosure('인용 [1][3][14] 그리고 【2】 끝'))).not.toMatch(/\[1\]|\[3\]|\[14\]|【2】/)
    expect(readable(scrubAnalystDisclosure('₩유상증자'))).toBe('유상증자')
    expect(readable(scrubAnalystDisclosure('$ 매수세'))).toBe('매수세')
  })

  it('broad rules: flow amounts, packet jargon, bare domains, source residue, English brokers', () => {
    const flow = readable(scrubAnalystDisclosure('기관 일간 -76B KRW, bp pct 91.3'))
    expect(flow).not.toMatch(/\d/)
    expect(flow).not.toMatch(/pct|KRW|bp/i)
    expect(flow).toContain('기관')
    expect(flow).toMatch(/순매도/)

    const broker = readable(scrubAnalystDisclosure('Korea Investment & Securities의 애널리스트들'))
    expect(broker).toBe('일부 증권사의 애널리스트들')
    expect(broker).not.toMatch(/Korea Investment/i)

    const domain = readable(scrubAnalystDisclosure('상승 alphasquare.co.krhome)) 압력'))
    expect(domain).not.toMatch(/alphasquare|co\.kr|home/i)
    expect(domain).not.toMatch(/\){2}/)
    expect(domain).toContain('상승')
    expect(domain).toContain('압력')

    expect(readable(scrubAnalystDisclosure('추가 상승을 시사합니다; 출처:.'))).toBe('추가 상승을 시사합니다.')
    expect(readable(scrubAnalystDisclosure('예정된 1.2조 유상증자'))).toBe('예정된 1.2조 유상증자')
    expect(readable(scrubAnalystDisclosure('5,000억 원 규모 자사주 매입'))).toBe('5,000억 원 규모 자사주 매입')
    expect(scrubAnalystDisclosure('외국인의 5d 순매수')).toBe('외국인의 5d 순매수')
    expect(readable(scrubAnalystDisclosure('20 거래일 동안 -5.5%'))).toBe('20 거래일 동안 -5.5%')
  })
})

describe('equity qualitative prompt line', () => {
  it('is the same sentence on official, crow, and consensus equity prompts', () => {
    expect(CONTRACT_EQUITY_LINE).toBe(EQUITY_QUALITATIVE_GUIDANCE)
    const official = systemPromptFor({ league_tier: 'premier' }, answerContractFor('binary_close_higher'), 'stock')
    const scout = systemPromptFor({ league_tier: 'scout' }, answerContractFor('binary_close_higher'), 'stock')
    const crowUs = buildCrowSystemPrompt('stock', 'STOCK:NASDAQ:AAPL')
    const crowKr = buildCrowSystemPrompt('stock', 'KRSTOCK:KOSPI:005930')
    const consensus = buildConsensusSystemPrompt('stock')
    for (const blob of [official, scout, crowUs, crowKr, consensus]) {
      expect(blob).toContain(EQUITY_QUALITATIVE_GUIDANCE)
    }
    expect(buildCrowSystemPrompt('commodity')).not.toContain(EQUITY_QUALITATIVE_GUIDANCE)
    expect(buildConsensusSystemPrompt()).not.toContain(EQUITY_QUALITATIVE_GUIDANCE)
    for (const instrument of ['KRSTOCK:KOSPI:402340', 'STOCK:NYSE:TSM']) {
      const stock = buildConsensusSystemPrompt('stock', instrument)
      expect(stock).toContain('시장 신호 없음')
      expect(stock).not.toContain('기관 컨센서스 목표가를 검색')
    }
    expect(
      parseConsensusOutput('{"direction":null,"found":false,"rationale":"컨센서스 목표가"}', {
        category: 'stock',
        instrument: 'KRSTOCK:KOSPI:402340',
      }),
    ).toEqual({ kind: 'abstain', rationale: '시장 신호 없음' })
    expect(
      parseConsensusOutput('{"direction":null,"found":false,"rationale":"no book"}', { category: 'gold_metal' }),
    ).toMatchObject({ kind: 'abstain' })
    expect(consensusRationaleNeedsRetry('증권사 리포트도 평균 목표가가 상향', 'stock')).toBe(true)
    expect(systemPromptFor({ league_tier: 'premier' }, answerContractFor('binary_subject_outcome'), 'sports')).not.toContain(
      EQUITY_QUALITATIVE_GUIDANCE,
    )
  })
})

describe('display-layer wiring', () => {
  it('card tiles scrub a stored stock rationale at display time', () => {
    const round: RoundRow = {
      id: 'r1',
      proposition_text: 'Will 005930 close higher?',
      category: 'stock',
      color_bucket: 'green',
      instrument: 'KRSTOCK:KOSPI:005930',
      horizon: '1d',
      resolution_rule: 'KRX',
      resolves_at: '2026-10-06T06:30:00.000Z',
      opened_at: '2026-10-02T09:00:00.000Z',
      actual_outcome: null,
      resolved_at: null,
    }
    const pred: PredictionRow = {
      model_id: 'crow',
      brand: 'Mistral',
      camp: 'other',
      league_tier: 'extra',
      predicted_direction: 'down',
      predicted_value: 62,
      reasoning_snippet: 'short-ratio spike (14.30 vs 10.28 avg)',
      is_correct: null,
      cost_usd: 0.01,
      predicted_at: '2026-10-02T10:00:00.000Z',
    }
    const card = buildCardData(round, [pred])
    expect(card.models[0]?.reasoning_snippet).toContain('14.30')
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: card.models,
        tierSplit: card.tierSplit,
        t: getLeagueUiPack('en'),
        category: 'stock',
      }),
    )
    expect(html).not.toMatch(/14\.30|10\.28/)
    expect(html).toMatch(/short-ratio spike/i)
  })

  it('deep snapshot scrubs equity analyst figures and leaves a gold briefing alone', () => {
    const snap = buildDeepSnapshot('open', {
      category: 'stock',
      report: 'JPMorgan과 Goldman의 매도(Sell) 의견 목표가. PER ~287x.',
      analyses: [{ roleId: 'price', roleLabel: 'Price', provider: 'openai', ok: true, analysis: '333억 KRW 규모의 기관 순매수' }],
      result: { synthesis: '1.4M 컨센서스 목표가 (kr.investing.com)' },
    })
    if (snap?.kind !== 'open') throw new Error('expected open')
    expect(snap.briefing).not.toMatch(/JPMorgan|Goldman|287/i)
    expect(snap.briefing).toContain('일부 증권사')
    expect(snap.analyses[0]?.content).toContain('기관 순매수')
    expect(snap.analyses[0]?.content).not.toMatch(/333/)
    expect(snap.synthesis ?? '').not.toMatch(/1\.4M|kr\.investing/i)
    expect(snap.synthesis ?? '').not.toContain('컨센서스 목표가')

    const gold = buildDeepSnapshot('open', {
      category: 'crypto',
      report: 'Pinnacle is unrelated here',
      analyses: [],
    })
    if (gold?.kind !== 'open') throw new Error('expected open')
    expect(gold.briefing).toContain('Pinnacle')
  })
})

describe('leftover English is translated after a pre- and post-scrub', () => {
  beforeEach(() => {
    mocks.runSingleAiProvider.mockReset()
  })

  it('KRX leftover English is routed through translation and ends up in Korean, with the close and rights issue kept', async () => {
    mocks.runSingleAiProvider.mockResolvedValue({
      text: '[{"id":0,"text":"KRX 데이터는 10-02 종가가 115,700 부근이고 1.2조 유상증자가 있다."}]',
      promptTokens: 10,
      completionTokens: 10,
      costUsd: 0,
      model: 'gemini-3.5-flash',
    })
    const { translateRoundRationales } = await import('../rationale-i18n')
    const raw = 'KRX data show a 10-02 close near 115,700 and a 1.2조 rights issue…'
    const result = await translateRoundRationales(
      [{ predictionId: 'pred-krx', text: raw }],
      'ko',
      {
        loadCached: async () => ({ rows: [], error: null }),
        upsert: async () => ({ error: null }),
      },
      'stock',
    )
    expect(mocks.runSingleAiProvider).toHaveBeenCalled()
    const prompt = String(mocks.runSingleAiProvider.mock.calls[0]?.[0]?.prompt ?? '')
    expect(prompt).toContain('115,700')
    expect(prompt).toContain('1.2조')
    const ko = result.translations['pred-krx'] ?? ''
    expect(ko).toMatch(/[가-힣]/)
    expect(ko).not.toMatch(/KRX data show/i)
    expect(ko).toContain('115,700')
    expect(ko).toContain('1.2조')
  })

  it('post-scrub strips a raw ratio the translator copied back', async () => {
    mocks.runSingleAiProvider.mockResolvedValue({
      text: '[{"id":0,"text":"공매도 비중 스파이크 (14.30 vs 10.28 avg)"}]',
      promptTokens: 10,
      completionTokens: 10,
      costUsd: 0,
      model: 'gemini-3.5-flash',
    })
    const { translateRoundRationales } = await import('../rationale-i18n')
    const result = await translateRoundRationales(
      [{ predictionId: 'pred-short', text: 'short-ratio spike (14.30 vs 10.28 avg)' }],
      'ko',
      {
        loadCached: async () => ({ rows: [], error: null }),
        upsert: async () => ({ error: null }),
      },
      'stock',
    )
    const ko = result.translations['pred-short'] ?? ''
    expect(ko).not.toMatch(/14\.30|10\.28/)
    expect(ko).toMatch(/공매도 비중|short-ratio/i)
  })

  it('rejects a Korean "기준 금리" rendering when the source says base rate, and the prompt carries the glossary', async () => {
    mocks.runSingleAiProvider.mockResolvedValue({
      text: '[{"id":0,"text":"기준 금리가 과거보다 높다."}]',
      promptTokens: 10,
      completionTokens: 10,
      costUsd: 0,
      model: 'gemini-3.5-flash',
    })
    const { translateRoundRationales } = await import('../rationale-i18n')
    const source = 'The base rate of up weeks in this window is 54%, and price is above SMA50.'
    const result = await translateRoundRationales(
      [{ predictionId: 'pred-base', text: source }],
      'ko',
      {
        loadCached: async () => ({ rows: [], error: null }),
        upsert: async () => ({ error: null }),
      },
      'stock',
    )
    expect(result.translations['pred-base']).toBeUndefined()
    const system = String(mocks.runSingleAiProvider.mock.calls[0]?.[0]?.systemPrompt ?? '')
    expect(system).toContain('기저율(과거 같은 기간 상승 비율)')
    expect(system).toContain('이동평균선')
    expect(system).toContain('기준 금리')
  })
})

describe('write-path source', () => {
  it('orchestrator, extra upsert, translation, and deep persist go through visibleLeagueText', () => {
    const orch = readFileSync(join(ROOT, 'lib/league/orchestrator.ts'), 'utf8')
    const extra = readFileSync(join(ROOT, 'lib/league/extra/run.ts'), 'utf8')
    const i18n = readFileSync(join(ROOT, 'lib/league/rationale-i18n.ts'), 'utf8')
    const deepStore = readFileSync(join(ROOT, 'lib/league/deep-store.ts'), 'utf8')
    expect(orch).toContain('visibleLeagueText(category, rawRationale)')
    expect(extra).toContain('visibleLeagueText(row.category, row.reasoning_snippet)')
    expect(i18n).toContain('visibleLeagueText(category, sports)')
    expect(i18n).toContain('visibleLeagueText(category, text)')
    expect(deepStore).toContain('scrubVisibleDeepState')
  })
})
