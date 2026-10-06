import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DeepReportView } from '../../../components/league/DeepReportView'
import { ModelTile } from '../../../components/league/ModelTile'
import { answerContractFor } from '../answer-contract'
import type { CardModelPrediction, ConsensusSummary } from '../card-types'
import { rankedPropositionDisplay } from '../card-header-copy'
import { consensusHeadline } from '../compliance'
import { buildDeepSnapshot, type DeepReportSnapshot } from '../deep-snapshot'
import { blindRevoteUserPrompt, chairUserPrompt } from '../deep-report-prompts'
import { formatMissingTurnLog, keepRevoteTally, revoteTallyLine, stanceTallyLine, type ReportTurn } from '../deep-report-run'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack } from '../i18n/dictionary'
import { sideLabelsFor } from '../side-labels'
import { fixKoreanJosa, josa } from '../korean-josa'
import { logUnparseableRaw } from '../orchestrator'
import { resolveLocalizedProposition } from '../proposition-i18n'
import { CLUB_DISPLAY } from '../sports/club-names'
import { impliedProbabilityPct, marketBaselinePctForCard } from '../sports-market'
import { scrubSportsDisclosure, sportsMarketBaselineLine } from '../sports-disclosure'
import { displaySportsTeam, formatSportsPropositionLocalized } from '../sports-display'
import { formatOpenTechProposition, type OpenTechClaim } from '../gateway/adapters/tech-resolve'
import { visibleLeagueText } from '../visible-disclosure'

const ARSENAL = 'MATCH:soccer_epl:af-arsenal:home:1760000000000:Arsenal:Leeds'
const STORED_EN = 'Will Arsenal win the Premier League match against Leeds?'
const STORED_KO = '아스날가 Leeds와의 프리미어리그 경기에서 정규시간(90분+추가시간, 무승부는 패)에 이길까?'

function shown(html: string): string {
  return html.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
}

describe('sports rationales drop bookmaker and odds sentences', () => {
  const samples = [
    '북메이커/모델 합의 승률 ~70-75%이다. 최근 5경기에서 4승이다.',
    '시장의 약 65-70% 내재 승률이 나와 있다. 홈 수비가 안정적이다.',
    '북메이커들은 아스날을 탑독으로 평가한다. 세트피스 득점이 늘었다.',
    'Bet365 moneyline and the betting line both lean home. The press is fit.',
    'Pinnacle implied probability is the whole case. Arsenal kept a clean sheet.',
  ]

  it('drops the odds sentence and keeps the sentence after it', () => {
    for (const sample of samples) {
      const out = visibleLeagueText('sports', sample)
      expect(out).not.toMatch(/북메이커|배당|오즈|탑독|bookmaker|sportsbook|moneyline|betting line|implied probability|Bet365|Pinnacle/i)
      expect(out).toMatch(/최근 5경기|홈 수비|세트피스|press is fit|clean sheet/)
    }
    expect(scrubSportsDisclosure('북메이커/모델 합의 승률 ~70-75%')).toBeNull()
  })

  it('lets the market seat say only the baseline percent', () => {
    const line = sportsMarketBaselineLine('시장 기준선', 71)
    expect(line).toBe('시장 기준선 71%')
    expect(line).not.toMatch(/배당|북메이커|odds/i)
    const t = getLeagueUiPack('ko')
    const model: CardModelPrediction = {
      prediction_id: null,
      model_id: 'consensus',
      brand: '시장',
      model_identifier: 'consensus',
      camp: 'other',
      league_tier: 'extra',
      direction: 'yes',
      probability: 71,
      magnitude: null,
      qualifierText: null,
      reasoning_snippet: '북메이커/모델 합의 승률 ~70-75%. 시장의 약 65-70% 내재 승률.',
      is_correct: null,
      cost_usd: 0,
      predicted_at: '2026-10-06T00:00:00.000Z',
    }
    const html = shown(renderToStaticMarkup(createElement(ModelTile, { model, t, category: 'sports', locale: 'ko' })))
    expect(html).toContain('시장 기준선 71%')
    expect(html).not.toMatch(/북메이커|배당|odds|내재 승률/)
  })
})

describe('hero market baseline reads every priced source', () => {
  it('turns a stored 0–1 implied probability into a percent and ignores search', () => {
    for (const source of ['kalshi', 'polymarket', 'odds_api', 'api_football'] as const) {
      expect(impliedProbabilityPct(source, 0.71)).toBe(71)
    }
    expect(impliedProbabilityPct('search', 0.71)).toBeNull()
    expect(impliedProbabilityPct('none', 0.71)).toBeNull()
    expect(marketBaselinePctForCard(71, null)).toBe(71)
    expect(marketBaselinePctForCard(null, 64)).toBe(64)
    expect(marketBaselinePctForCard(71, 64)).toBe(71)
  })
})

describe('deep report title and Korean names', () => {
  it('uses the viewer locale for the report header, including stored sports text', () => {
    const header = rankedPropositionDisplay(ARSENAL, STORED_EN, 'ko', { en: STORED_EN, ko: STORED_KO })
    expect(header).toContain('아스날이')
    expect(header).toContain('리즈')
    expect(header).not.toContain('Leeds')
    expect(header).not.toContain('Will Arsenal')
    expect(resolveLocalizedProposition(
      { proposition_text: STORED_EN, category: 'sports', instrument: ARSENAL, propositions: { en: STORED_EN, ko: STORED_KO } },
      'ko',
    )).toBe(header)
  })

  it('names current clubs in Korean, Japanese, and Traditional Chinese', () => {
    expect(Object.keys(CLUB_DISPLAY).length).toBeGreaterThanOrEqual(200)
    expect(displaySportsTeam('Leeds', 'ko')).toBe('리즈')
    expect(displaySportsTeam('Leeds', 'ko', 'full')).toBe('리즈 유나이티드')
    expect(displaySportsTeam('Leeds', 'ja')).toBe('リーズ')
    expect(displaySportsTeam('Leeds', 'zh-TW')).toBe('里茲聯')
    expect(displaySportsTeam('Real Madrid', 'ko')).toBe('레알 마드리드')
    expect(displaySportsTeam('Juventus', 'ja')).toBe('ユベントス')
    expect(displaySportsTeam('Bayern', 'zh-TW')).toBe('拜仁慕尼黑')
    expect(displaySportsTeam('Paris Saint-Germain', 'ko', 'full')).toBe('파리 생제르맹')
    expect(displaySportsTeam('Los Angeles Dodgers', 'ja')).not.toBe('Los Angeles Dodgers')
    expect(displaySportsTeam('Los Angeles Lakers', 'zh-TW')).toBe('湖人')
    expect(displaySportsTeam('Kansas City Chiefs', 'ko')).toBe('캔자스시티')
    expect(displaySportsTeam('Toronto Maple Leafs', 'ja')).not.toBe('Toronto Maple Leafs')
    const parts = {
      league: 'soccer_epl',
      eventId: 'af-arsenal',
      side: 'home' as const,
      kickoffMs: 1760000000000,
      home: 'Arsenal',
      away: 'Leeds',
    }
    expect(formatSportsPropositionLocalized(parts, 'ko')).toContain('아스날이')
    expect(formatSportsPropositionLocalized(parts, 'ko')).not.toContain('Leeds')
  })

  it('picks 이/을/은/과 from the final consonant, including stored sentences', () => {
    expect(josa('아스날', '이/가')).toBe('이')
    expect(josa('3단 폴더블', '을/를')).toBe('을')
    expect(josa('새 GPU', '을/를')).toBe('를')
    expect(josa('폴더블 GPU', '을/를')).toBe('를')
    expect(josa('2026', '이/가')).toBe('가')
    expect(josa('NVIDIA', '이/가')).toBe('가')
    expect(fixKoreanJosa('새 GPU를 발표할까?')).toBe('새 GPU를 발표할까?')
    expect(fixKoreanJosa('폴더블 GPU를 출시할까?')).toBe('폴더블 GPU를 출시할까?')
    expect(fixKoreanJosa('NVIDIA가 발표할까?')).toBe('NVIDIA가 발표할까?')
    expect(fixKoreanJosa('2026을 넘길까?')).toBe('2026을 넘길까?')
    expect(fixKoreanJosa('아스날가 이긴다')).toBe('아스날이 이긴다')
    expect(fixKoreanJosa('3단 폴더블를 출시할까?')).toBe('3단 폴더블을 출시할까?')
    expect(fixKoreanJosa(fixKoreanJosa('아스날이 이긴다'))).toBe('아스날이 이긴다')
    const stored = resolveLocalizedProposition(
      {
        proposition_text: '삼성, 3단 폴더블를 출시할까?',
        category: 'tech',
        instrument: 'TECH:OPEN:samsung:release:3단_폴더블:20261231:store_listing',
        propositions: { ko: '삼성, 3단 폴더블를 출시할까?' },
      },
      'ko',
    )
    expect(stored).toContain('3단 폴더블을')
    expect(stored).not.toContain('폴더블를')
    const claim: OpenTechClaim = {
      subject: 'Samsung',
      subjectLabel: '삼성',
      event: 'release',
      object: '3단 폴더블',
      deadline: '2026-12-31',
      windowStart: '2026-10-06',
      horizon: '3m',
      verification: 'store_listing',
      instrument: 'TECH:OPEN:samsung:release:3단_폴더블:20261231:store_listing',
      korean: true,
      catalogCompanyId: null,
    }
    expect(formatOpenTechProposition(claim)).toContain('3단 폴더블을')
  })
})

describe('nemotron side answers and missing debate turns', () => {
  it('parses a truncated side object that follows a thought marker', () => {
    const raw = [
      '<|begin_of_thought|>side: no. probability: 40.<|end_of_thought|>',
      '<|channel|>final<|message|>',
      '{"side":"yes","probability":71,"qualifier":"2-1","rationale":"홈에서 더 강하다","strongest_counter":"원정 수비가 버틴다"',
    ].join('\n')
    const contract = answerContractFor('binary_subject_outcome')
    const parsed = contract.parse(raw)
    expect(parsed?.side).toBe('yes')
    expect(parsed?.probability).toBe(71)
    expect(parsed?.qualifierText).toBe('2-1')
    expect(contract.validate(parsed).ok).toBe(true)

    const lines = 'side: yes\nprobability: 68\nqualifier: 2-0\nrationale: "홈 우위"\nstrongest_counter: "부상이 변수"'
    const fromLines = contract.parse(lines)
    expect(fromLines?.side).toBe('yes')
    expect(fromLines?.probability).toBe(68)
    expect(fromLines?.qualifierText).toBe('2-0')
  })

  it('logs only the first 300 characters, with the round id, and returns nothing to store', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const body = `${'가'.repeat(300)}SECRET-TAIL`
    logUnparseableRaw('nemotron-3-ultra-550b', body, 'round-arsenal')
    const line = String(spy.mock.calls[0]?.[0])
    expect(line).toContain('model=nemotron-3-ultra-550b')
    expect(line).toContain('round=round-arsenal')
    expect(line).toContain('가'.repeat(300))
    expect(line).not.toContain('SECRET-TAIL')
    expect(logUnparseableRaw('nemotron-3-ultra-550b', body, 'round-arsenal')).toBeUndefined()
    spy.mockRestore()
  })

  it('names the provider and the reason when a debater turn is missing', () => {
    const line = formatMissingTurnLog('run-arsenal', 'rebuttal', 'xai', 'empty reply')
    expect(line).toContain('provider=xai')
    expect(line).toContain('reason=empty reply')
    expect(line).toContain('rebuttal')
  })
})

describe('blind re-vote', () => {
  const sideWords = { yes: '승', no: '패' }

  function turn(provider: string, side: 'yes' | 'no', finalSide: 'yes' | 'no', probability: number): ReportTurn {
    return {
      provider,
      model: provider,
      side,
      ok: true,
      attempts: 1,
      headline: '주장',
      points: [],
      rebuttal: [],
      finalSide,
      finalProbability: probability,
      whyChanged: null,
    }
  }

  it('asks for a neutral call and does not name an assigned side', () => {
    const prompt = blindRevoteUserPrompt({
      locale: 'ko',
      proposition: '아스날이 리즈 유나이티드와의 프리미어리그 경기에서 이길까?',
      packet: 'packet',
      evidence: 'E1 | 홈 성적',
      transcript: '## Claude\nOpening: 홈에서 더 강하다\nReply: 수비 공백은 인정한다',
    })
    expect(prompt).not.toMatch(/assigned/i)
    expect(prompt).not.toMatch(/you argued/i)
    expect(prompt).toContain('one_line_reason')
    expect(prompt).toContain('neutral referee')
    expect(prompt).toContain('[Full transcript]')
  })

  it('renders the debate stance and the blind re-vote, and highlights a flipped seat', () => {
    const snap = buildDeepSnapshot('report', {
      category: 'sports',
      proposition: STORED_EN,
      sideWords,
      outputLanguage: 'ko',
      openings: [turn('xai', 'no', 'no', 58), turn('openai', 'yes', 'yes', 70)],
      rebuttals: [],
      counters: [],
      revotes: [
        { ...turn('xai', 'no', 'yes', 62), whyChanged: '홈 성적이 더 무겁다' },
        { ...turn('openai', 'yes', 'yes', 70), whyChanged: '유지' },
      ],
      result: { ok: true, report: '승' },
    }) as DeepReportSnapshot
    expect(snap.vote).toMatchObject({ yes: 1, no: 1 })
    expect(snap.revote?.seats.find((seat) => seat.provider === 'xai')?.differs).toBe(true)
    expect(snap.revote?.seats.find((seat) => seat.provider === 'openai')?.differs).toBe(false)
    const html = shown(renderToStaticMarkup(createElement(DeepReportView, { snap, locale: 'ko' })))
    expect(html).toContain('토론 중 입장')
    expect(html).toContain('최종 투표 (편 떼고 재투표)')
    expect(html).toContain('data-testid="deep-report-vote"')
    expect(html).toContain('data-testid="deep-report-revote"')
    expect(html).toContain('data-revote-flip="true"')
    expect(html).toContain('배정된 편과 다름')
    expect(html.indexOf('토론 중 입장')).toBeLessThan(html.indexOf('최종 투표 (편 떼고 재투표)'))
  })

  it('gives the chair both tallies', () => {
    const openings = [turn('xai', 'no', 'no', 58), turn('openai', 'yes', 'yes', 70), turn('anthropic', 'no', 'no', 55)]
    const revotes = [turn('xai', 'no', 'yes', 62), turn('openai', 'yes', 'yes', 70), turn('anthropic', 'no', 'no', 57)]
    const stance = stanceTallyLine(openings, [], [])
    const revote = revoteTallyLine(revotes)
    expect(stance).toBe('During the debate: YES 1, NO 2.')
    expect(revote).toBe('Blind re-vote: YES 2, NO 1.')
    const chair = chairUserPrompt({
      locale: 'ko',
      proposition: '아스날이 이길까?',
      packet: 'packet',
      evidence: 'E1 | 홈 성적',
      debate: 'debate',
      fortySeatAggregate: 'n=40',
      categoryNote: '',
      sideWords,
      stanceTally: stance,
      revoteTally: revote,
    })
    expect(chair).toContain('[Positions during the debate]')
    expect(chair).toContain(stance)
    expect(chair).toContain('[Blind re-vote]')
    expect(chair).toContain(revote)
  })

  it('drops a broken re-vote and keeps the debate tally', () => {
    const openings = [turn('xai', 'no', 'no', 58), turn('openai', 'yes', 'yes', 70)]
    const broken = [{ ...turn('xai', 'no', 'yes', 62), ok: false, finalSide: null }]
    expect(keepRevoteTally(broken, openings)).toBe(false)
    expect(keepRevoteTally([turn('xai', 'no', 'yes', 62), turn('openai', 'yes', 'yes', 70)], openings)).toBe(true)
    expect(revoteTallyLine([])).toBe('Blind re-vote: unavailable. Use the debate tally.')
    const snap = buildDeepSnapshot('report', {
      category: 'sports',
      proposition: STORED_EN,
      sideWords,
      openings,
      rebuttals: [],
      counters: [],
      revotes: [],
      result: { ok: true, report: '승' },
    }) as DeepReportSnapshot
    expect(snap.vote).toMatchObject({ yes: 1, no: 1 })
    expect(snap.revote).toBeNull()
    const html = shown(renderToStaticMarkup(createElement(DeepReportView, { snap, locale: 'ko' })))
    expect(html).toContain('토론 중 입장')
    expect(html).not.toContain('data-testid="deep-report-revote"')
    const chair = chairUserPrompt({
      locale: 'ko',
      proposition: '아스날이 이길까?',
      packet: 'packet',
      evidence: 'E1',
      debate: 'debate',
      fortySeatAggregate: 'n=40',
      categoryNote: '',
      sideWords,
      stanceTally: stanceTallyLine(openings, [], []),
      revoteTally: revoteTallyLine([]),
    })
    expect(chair).toContain('During the debate: YES 1, NO 1.')
    expect(chair).toContain('Blind re-vote: unavailable. Use the debate tally.')
  })
})

describe('card headline opposite share', () => {
  const close: ConsensusSummary = {
    tally: { up: 22, down: 18, flat: 0, abstain: 0 },
    majorityDirection: 'up',
    totalModels: 40,
    respondedModels: 40,
    avgProbability: 54,
    aggregateDirection: 'up',
    aggregateProbability: 54,
    aggregateMagnitudePct: 0.4,
    aggregateMagnitudeN: 40,
  }

  it('keeps the probability line primary and appends 100 minus that share in every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const t = getLeagueUiPack(locale)
      const line = consensusHeadline(close, t)
      expect(line, locale).toContain('54')
      expect(line, locale).toContain('46')
      expect(line, locale).toContain(t.direction.badge.up)
      expect(line, locale).toContain(t.direction.badge.down)
      expect(line, locale).toBe(t.hero.strengthHeadline(t.direction.badge.up, 54, t.hero.strength.toss, t.direction.badge.down, 46))
    }
    expect(consensusHeadline(close, getLeagueUiPack('ko'))).toBe('상승 우세 54% · 박빙 (하락 가능성 46%)')
  })

  it('names the sports opposite as draw-or-loss', () => {
    const t = getLeagueUiPack('ko')
    const labels = sideLabelsFor(
      {
        proposition_kind: 'binary_subject_outcome',
        category: 'sports',
        subject_label: 'Arsenal',
        instrument: ARSENAL,
      },
      t,
      'ko',
    )
    const sports: ConsensusSummary = {
      ...close,
      tally: { up: 39, down: 1, flat: 0, abstain: 0 },
      majorityDirection: 'yes',
      aggregateDirection: 'yes',
      aggregateProbability: 69,
      aggregateMagnitudePct: null,
      aggregateMagnitudeN: 0,
    }
    expect(consensusHeadline(sports, t, labels)).toBe(
      '아스날 승 우세 69% · 박빙에 가까운 우세 (아스날 무·패 가능성 31%)',
    )
  })
})
