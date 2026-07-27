import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  runSingleAiProvider,
  MODEL_BY_PROVIDER,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'

/**
 * GUNPO "매스컴" (media watch) module — a structured daily media briefing
 * (cloned from lib/motie/mediawatch.ts).
 *
 * DESIGN CONSTRAINTS (same isolation discipline as the rest of lib/gunpo):
 *   - May import lib/ai/router.ts (runSingleAiProvider) only.
 *   - MUST NOT touch or depend on app/api/synod/* — self-contained.
 *   - AIMANI must NOT import lib/gunpo. The folder stays lifetable to a standalone
 *     site. 'server-only'. Never throws — every exported fn returns a
 *     result object; a failed sub-call becomes an ok:false entry.
 *
 * INDEPENDENT of the DEEP 4-beat engine: it does NOT convene experts, debate,
 * deliberate, or vote. It searches Korean news for what's happening in the
 * region right now and produces an analyzed, structured briefing.
 *
 * VALUE PROPOSITION (baked into the prompts):
 *   A public official could just Naver/Google "지역 뉴스". Our differentiator is
 *   NOT raw collection (we can't beat search at that) — it's PROCESSING:
 *     (1) a WIDE net across many local policy axes in one run,
 *     (2) TONE (논조) analysis, not a headline list,
 *     (3) signal vs noise STRUCTURE — big shared issues up top, minor-but-notable
 *         ones briefly below,
 *     (4) NATIONAL vs LOCAL press framing contrast.
 *   Honesty: summarize/analyze actual found coverage, cite sources, never fabricate.
 *
 * STEP7: umbrellas + search role + queries are now 군포화. Two search axes:
 *   A. 군포시·경기도 지역언론 및 시청 공식 발표 (안건 관련 최신 보도·공고)
 *   B. 유사 규모 수도권 기초지자체의 동일 현안 대응 사례
 * Every query embeds '군포시' or '경기도' so Perplexity stays region-anchored.
 */

/**
 * Search-call cap. This module is far lighter than DEEP (which runs 40–50 calls),
 * but it is STILL a cap, not unlimited. Separate constant — must NOT touch DEEP's
 * own MAX_SEARCHES.
 */
export const MEDIAWATCH_MAX_SEARCHES = 10

/** Token budget per Perplexity umbrella search (3-5 items with outlet/date/논조). */
const SEARCH_MAX_TOKENS = 1800

/** Token budget for the single synthesis (anthropic) call — 1.5–2 A4 pages of Korean. */
const SYNTHESIS_MAX_TOKENS = 7000

/** The synthesis brand — strong at careful structuring and tone analysis. */
const SYNTHESIS_PROVIDER: ExtendedAiProviderName = 'anthropic'

/** The search brand — real-time Korean news retrieval. */
const SEARCH_PROVIDER: ExtendedAiProviderName = 'perplexity'

/**
 * Loose policy/interest UMBRELLAS reflecting 군포시's actual priorities. These
 * are broad HINTS, not rigid fixed questions — each becomes ONE Perplexity search.
 * Every hint embeds '군포시' or '경기도' so Perplexity stays region-anchored. The
 * trailing free-catch entries (isFree) deliberately do NOT force everything into
 * an umbrella, so unexpected issues surface.
 *
 * STEP7 search axes (baked into the hint phrasing):
 *   A. 군포시·경기도 지역언론 및 시청 공식 발표 (안건 관련 최신 보도·공고)
 *   B. 유사 규모 수도권 기초지자체의 동일 현안 대응 사례
 */
const MEDIAWATCH_UMBRELLAS: ReadonlyArray<{
  id: string
  label: string
  hint: string
  isFree?: boolean
}> = [
  {
    id: 'urban-renewal',
    label: '도시·정비 (신도시·원도심)',
    hint: '군포시 산본 1기 신도시·군포역·금정역 원도심 노후화, 역세권 개발, 재정비 — 경기도 군포시청 공식 발표와 지역언론 최신 보도',
  },
  {
    id: 'industry-complex',
    label: '산업지 전환 (당정동 복합지구)',
    hint: '군포시 당정동 노후 공업지역 첨단산업·주거·문화 복합지구 전환 — 경기도 군포시청 공식 발표와 지역언론 보도',
  },
  {
    id: 'logistics-terminal',
    label: '물류·교통 (부곡동 터미널)',
    hint: '군포시 부곡동 복합물류터미널 화물차 통행·소음·생활권 단절, 기능전환 논의 — 경기도 군포시 지역언론 보도',
  },
  {
    id: 'river-restoration',
    label: '산본천 복원·침수',
    hint: '군포시 산본천 복원 사업 국비 확보, 산본1동 저지대 집중호우 침수 이력 — 경기도 군포시청 발표와 지역언론 보도',
  },
  {
    id: 'welfare-residence',
    label: '복지·정주 (인구·청년)',
    hint: '군포시 인구 감소·청년층 유출, 주거·일자리·보육·문화 정주 여건 — 경기도 군포시청 복지·행정 발표',
  },
  {
    id: 'transport',
    label: '교통 (버스·환승)',
    hint: '군포시 금정역 1·4호선 환승, GTX-C 정차역, 버스 정류소·도착정보 — 경기도 군포시 지역언론 교통 보도',
  },
  {
    id: 'peer-cities',
    label: '타 수도권 기초지자체 사례',
    hint: '유사 규모 수도권 기초지자체(과천·의왕·안양·시흥 등)의 노후 신도시 재정비·역세권 개발·공업지 전환 대응 사례 — 경기도 지자체 비교',
  },
  {
    id: 'free-1',
    label: '그 외 화제 (자유 탐색)',
    hint: '위 분류에 속하지 않더라도 최근 경기도 군포시에서 가장 화제가 된 일·사건·정책',
    isFree: true,
  },
  {
    id: 'free-2',
    label: '그 외 화제 (자유 탐색 2)',
    hint: '최근 군포시민 사이에서 관심이 높거나 논란이 된 경기도 군포시 지역 이슈',
    isFree: true,
  },
]

/** Briefing perspective — governance (decision-maker) vs resident (daily life). */
export type JejuMediaWatchMode = 'governance' | 'resident'

/** One umbrella's executed search and its (Perplexity) result. */
export type JejuMediaWatchSearch = {
  /** Umbrella id (stable). */
  id: string
  /** Korean display label for this umbrella. */
  label: string
  /** The query actually run. */
  query: string
  ok: boolean
  /** Perplexity's answer text (null when the call failed). */
  result: string | null
  /** Best-effort source URLs pulled from the result (for verification). */
  sources: string[]
  error?: string
}

/** The full structured media briefing. */
export type JejuMediaWatch = {
  ok: boolean
  /** Today's date (KST) the run was anchored to, e.g. '2026년 06월 22일 월요일'. */
  date: string
  mode: JejuMediaWatchMode
  /** Per-umbrella search results (ok and failed entries both preserved). */
  searches: JejuMediaWatchSearch[]
  /** 핵심 이슈 — prominent, widely-covered issues with tone analysis. */
  coreIssues: string | null
  /** 주변 이슈 — minor-but-notable issues, listed briefly below the core. */
  minorIssues: string | null
  /** 전국 vs 군포시 지역 언론 논조 대비. */
  nationalVsLocal: string | null
  /** Short top-of-page synthesis summary. */
  summary: string | null
  error?: string
}

/**
 * Throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * Mirrors brief.ts / deep.ts: with sessionId:null + userId:null the router does
 * NO DB inserts and NO BYOK reads, so this client is never dereferenced for I/O.
 * Local copy keeps lib/jeju portable.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'mediawatch-no-db') as unknown as SupabaseClient
}

/** Strips ``` / ```json fences and returns the inner JSON-ish text. */
function stripFences(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) text = text.slice(start, end + 1)
  }
  return text
}

/** Resolves a provider to a valid router provider, defaulting to the fallback. */
function resolveProvider(
  p: ExtendedAiProviderName,
  fallback: ExtendedAiProviderName
): ExtendedAiProviderName {
  return Object.prototype.hasOwnProperty.call(MODEL_BY_PROVIDER, p) ? p : fallback
}

/** Today's date in KST, as a Korean string, so "최근/오늘" is anchored. */
function todayKST(): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).format(new Date())
  } catch {
    // Intl should never throw for this, but stay defensive (never throw).
    return new Date().toISOString().slice(0, 10)
  }
}

/** Pulls http(s) URLs out of a result string (best-effort, deduped). */
function extractSources(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)<>"']+/g)
  if (!matches) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    const url = m.replace(/[.,)\]]+$/, '')
    if (!seen.has(url)) {
      seen.add(url)
      out.push(url)
    }
  }
  return out
}

/** Perplexity search-role system prompt — anchored to today, honesty-constrained. */
function buildSearchSystemPrompt(today: string): string {
  return [
    `당신은 경기도 군포시 관련 최신 언론 보도를 찾아 정리하는 검색 전문가입니다. 오늘은 ${today}(한국 표준시)입니다.`,
    '주어진 주제 영역에 대해, 가능한 한 최근의 실제 군포시·경기도 관련 보도·공고를 찾아 한국어로 정리하세요.',
    '검색 축은 두 가지입니다:',
    '  A. 군포시·경기도 지역언론 및 군포시청 공식 발표 (안건 관련 최신 보도·공고)',
    '  B. 유사 규모 수도권 기초지자체(과천·의왕·안양·시흥 등)의 동일 현안 대응 사례',
    '모든 검색 질의에는 반드시 "군포시" 또는 "경기도"가 포함되도록 하세요.',
    '',
    '목표: 해당 영역에서 실제로 보도된 기사·보고서를 3~5건 찾아 각각 따로 정리하세요. 보도가 실제로 많으면 5건, 적으면 있는 만큼(최소 1건)만 쓰세요.',
    '각 보도 항목마다 다음 네 가지를 빠짐없이 포함하세요:',
    '① 언론사(매체명): 군포·경기 지역언론(경기일보·경기신문·군포시청 공식 홈페이지 등)이면 "지역지", 전국 언론이면 "전국지"로 함께 표시.',
    '② 헤드라인 요지: 제목을 그대로 베끼지 말고 의미를 풀어서 쓰세요(직접 인용은 아주 짧게만, 큰따옴표로).',
    '③ 보도 날짜: 가능하면 명확히 쓰세요. 날짜를 확정할 수 없으면 "날짜 불명", 오래된 기사이면 "오래된 기사"로 표시하고 절대 지어내지 마세요.',
    '④ 논조(framing): 이 보도가 사안을 어떻게 바라보는지(긍정적/부정적/중립적, 무엇을 강조하고 무엇을 우려하는지) 1~2문장으로 설명하세요.',
    '가능하면 출처 URL도 포함하세요.',
    '',
    '가능하면 군포·경기 지역언론과 전국 언론을 섞어서 폭넓게 보세요.',
    '규칙(엄수): 실재하지 않는 기사·날짜·수치를 절대 지어내지 마세요. 지지율·찬성률 같은 정량 수치는 만들지 말고, 보도 논조는 정성적으로만 다루세요. 해당 영역에서 보도를 찾지 못했으면 "이 영역에서 최근 군포시·경기도 관련 보도를 찾지 못했습니다"라고 솔직히 쓰세요.',
  ].join('\n')
}

/** Runs ONE umbrella search via Perplexity. Never throws. */
async function runOneMediaSearch(
  umbrella: { id: string; label: string; hint: string },
  today: string
): Promise<JejuMediaWatchSearch> {
  const query = `${umbrella.hint} — 오늘(${today}) 기준 가장 최근의 군포시·경기도 관련 보도`
  const base = { id: umbrella.id, label: umbrella.label, query }

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: resolveProvider(SEARCH_PROVIDER, 'perplexity'),
      prompt: query,
      systemPrompt: buildSearchSystemPrompt(today),
      maxCompletionTokens: SEARCH_MAX_TOKENS,
    })
  } catch (e: unknown) {
    return {
      ...base,
      ok: false,
      result: null,
      sources: [],
      error: `검색 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ...base,
      ok: false,
      result: null,
      sources: [],
      error: r.error ?? '검색 결과가 비어 있습니다.',
    }
  }

  return { ...base, ok: true, result: r.text, sources: extractSources(r.text) }
}

/** Casts the wide net: runs all umbrella searches in parallel, capped. Never throws. */
async function runMediaSearches(today: string): Promise<JejuMediaWatchSearch[]> {
  const toRun = MEDIAWATCH_UMBRELLAS.slice(0, MEDIAWATCH_MAX_SEARCHES)
  const settled = await Promise.allSettled(toRun.map((u) => runOneMediaSearch(u, today)))

  return settled.map((res, i) => {
    if (res.status === 'fulfilled') return res.value
    const u = toRun[i]!
    return {
      id: u.id,
      label: u.label,
      query: u.hint,
      ok: false,
      result: null,
      sources: [],
      error: res.reason instanceof Error ? res.reason.message : 'search rejected',
    }
  })
}

/**
 * The ONLY thing that differs between modes is the synthesis PERSPECTIVE (~20-30%
 * of the prompt). Same engine, one switched string — never duplicate the pipeline.
 */
function perspectiveFor(mode: JejuMediaWatchMode): string {
  if (mode === 'resident') {
    return [
      '관점: 일반 군포시민의 시각으로 정리하세요.',
      '"내 지역에 무슨 일이 일어나고 있나"를 중심으로, 생활·체감에 미치는 영향(물가, 교통, 환경, 일상)을 우선하세요.',
      '행정 용어보다 시민이 이해하기 쉬운 표현을 쓰세요.',
    ].join('\n')
  }
  return [
    '관점: 정책 결정자(공무원)가 알아야 할 시각으로 정리하세요.',
    '여론·언론 리스크, 정책 함의, 쟁점화 가능성을 우선하세요.',
    '어떤 사안이 향후 정치적·행정적으로 부담이 될 수 있는지 짚어주세요.',
  ].join('\n')
}

/** Synthesis system prompt — structure + honesty + the mode-specific perspective. */
function buildSynthesisSystemPrompt(mode: JejuMediaWatchMode, today: string): string {
  return [
    `당신은 경기도 군포시 관련 언론 보도를 종합·분석하는 미디어 분석가입니다. 오늘은 ${today}(한국 표준시)입니다.`,
    '여러 주제 영역에 대해 수집된 실제 보도 자료가 주어집니다. 당신의 가치는 단순 수집이 아니라 "가공"입니다:',
    '- 많이 다뤄진 큰 사안과 적게 다뤄진 사안을 구분(신호 vs 잡음)하고,',
    '- 헤드라인 나열이 아니라 논조(tone)를 분석하며,',
    '- 전국 언론과 군포·경기 지역언론의 프레이밍 차이를 대비하고,',
    '- 공무원이 검증할 수 있도록 출처(매체·날짜)를 본문에 보존합니다.',
    '',
    perspectiveFor(mode),
    '',
    '분량 지침(중요): A4 1.5~2장 분량의 충실한 한국어 브리핑을 목표로 하세요. 수집된 실제 보도가 풍부하면 그것을 충분히 반영해서 쓰세요. 단, 분량은 반드시 실제 수집 자료에서 나와야 합니다 — 자료가 빈약한 영역을 억지로 늘리지 마세요.',
    '',
    '출력 형식(매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만. 각 값은 한국어 산문/목록 문자열입니다.',
    '스키마:',
    '{',
    '  "summary": "최상단 요약 (4~6줄). 오늘 군포시·경기도 언론 지형의 큰 그림 — 가장 뜨거운 사안 2~3개와 전체 논조 분위기.",',
    '  "coreIssues": "핵심 이슈 — 여러 매체에서 크게 다뤄진 주요 사안들. 각 사안마다: (1) 어떤 매체들이 어떤 날짜에 보도했는지, (2) 각 보도의 논조(긍정/부정/중립, 강조점, 우려), (3) 매체 간 논조 차이가 있으면 대비, (4) 이 사안이 정책적으로 왜 중요한지. 사안이 여럿이면 각각 충분히 다루세요. 이 섹션에 가장 큰 비중을 두세요.",',
    '  "minorIssues": "주변 이슈 — 보도량은 적지만 놓치면 안 될 사안들. 각 항목마다 매체·날짜·논조를 한 줄~두 줄로. 항목이 여럿이면 모두 포함하세요.",',
    '  "nationalVsLocal": "전국 언론과 군포·경기 지역언론의 논조가 갈리는 지점을 구체적으로 서술하세요. 같은 사안을 전국지는 어떻게, 지역지는 어떻게 프레이밍했는지 대비하세요. 차이가 뚜렷하지 않으면 그 이유와 함께 간략히 명시하세요."',
    '}',
    '',
    '정직성 규칙(최우선): 제공된 보도 자료에만 근거하세요. 실재하지 않는 기사·수치·반응을 절대 지어내지 마세요. 지지율·찬성률 등 정량 수치를 만들지 말고 논조는 정성적으로만 다루세요. 특정 영역 보도가 실제로 빈약했다면 억지로 채우지 말고 "이 영역은 수집된 보도가 적었습니다"라고 솔직히 한 줄로 쓰고 넘어가세요. 분량은 반드시 실제 자료에서 나와야 합니다.',
  ].join('\n')
}

/** Formats the umbrella search results into the synthesis input block. */
function formatSearchesForSynthesis(searches: JejuMediaWatchSearch[]): string {
  const blocks = searches.map((s) => {
    if (s.ok && s.result && s.result.trim() !== '') {
      return `### [${s.label}]\n${s.result.trim()}`
    }
    return `### [${s.label}]\n(검색 실패 또는 결과 없음: ${s.error ?? '미상'})`
  })
  return blocks.join('\n\n')
}

/** Validates/extracts a string field from the parsed synthesis JSON. */
function pickString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * Runs the media watch end to end: wide-net umbrella searches (parallel, capped)
 * → ONE structured synthesis call. Same engine for both modes; only the synthesis
 * perspective differs. Never throws; partial data on any sub-failure.
 */
export async function runJejuMediaWatch(params?: {
  mode?: JejuMediaWatchMode
}): Promise<JejuMediaWatch> {
  const mode: JejuMediaWatchMode = params?.mode === 'resident' ? 'resident' : 'governance'
  const date = todayKST()

  // (1) Cast the wide net. runMediaSearches never throws, but guard anyway.
  let searches: JejuMediaWatchSearch[]
  try {
    searches = await runMediaSearches(date)
  } catch (e: unknown) {
    return {
      ok: false,
      date,
      mode,
      searches: [],
      coreIssues: null,
      minorIssues: null,
      nationalVsLocal: null,
      summary: null,
      error: `검색 단계 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  const okSearches = searches.filter((s) => s.ok && s.result && s.result.trim() !== '')

  // Nothing to synthesize → return the (failed) searches honestly, no fabrication.
  if (okSearches.length === 0) {
    return {
      ok: false,
      date,
      mode,
      searches,
      coreIssues: null,
      minorIssues: null,
      nationalVsLocal: null,
      summary: null,
      error: '모든 언론 검색에 실패하여 종합 분석을 생성할 수 없습니다.',
    }
  }

  // (2) ONE synthesis call.
  const userPrompt = [
    `[오늘 날짜] ${date}`,
    '',
    '[수집된 군포시·경기도 관련 언론 보도 — 주제 영역별]',
    formatSearchesForSynthesis(searches),
    '',
    '위 자료를 종합하여 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  let r
  try {
    r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: resolveProvider(SYNTHESIS_PROVIDER, 'anthropic'),
      prompt: userPrompt,
      systemPrompt: buildSynthesisSystemPrompt(mode, date),
      maxCompletionTokens: SYNTHESIS_MAX_TOKENS,
    })
  } catch (e: unknown) {
    // Searches succeeded — keep them, note the synthesis failure.
    return {
      ok: false,
      date,
      mode,
      searches,
      coreIssues: null,
      minorIssues: null,
      nationalVsLocal: null,
      summary: null,
      error: `종합 분석 호출 실패(검색 결과는 유효): ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (r.error || !r.text) {
    return {
      ok: false,
      date,
      mode,
      searches,
      coreIssues: null,
      minorIssues: null,
      nationalVsLocal: null,
      summary: null,
      error: r.error ?? '종합 분석이 빈 응답을 반환했습니다.',
    }
  }

  // Parse the structured JSON; on parse failure, never lose the output — keep the
  // whole text as the summary so officials still get the analysis.
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(stripFences(r.text)) as Record<string, unknown>
  } catch {
    parsed = null
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: true,
      date,
      mode,
      searches,
      coreIssues: null,
      minorIssues: null,
      nationalVsLocal: null,
      summary: r.text.trim(),
    }
  }

  return {
    ok: true,
    date,
    mode,
    searches,
    coreIssues: pickString(parsed, 'coreIssues'),
    minorIssues: pickString(parsed, 'minorIssues'),
    nationalVsLocal: pickString(parsed, 'nationalVsLocal'),
    summary: pickString(parsed, 'summary'),
  }
}
