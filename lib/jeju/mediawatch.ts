import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  runSingleAiProvider,
  MODEL_BY_PROVIDER,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'

/**
 * Jeju "매스컴" (media watch) module — a structured daily media briefing.
 *
 * DESIGN CONSTRAINTS (same isolation discipline as the rest of lib/jeju):
 *   - May import lib/ai/router.ts (runSingleAiProvider) only.
 *   - MUST NOT touch or depend on app/api/synod/* — self-contained.
 *   - AIMANI must NOT import lib/jeju. The folder stays liftable to a standalone
 *     /jeju site. 'server-only'. Never throws — every exported fn returns a
 *     result object; a failed sub-call becomes an ok:false entry.
 *
 * INDEPENDENT of the DEEP 4-beat engine: it does NOT convene experts, debate,
 * deliberate, or vote. It searches Korean news for what's happening in Jeju right
 * now and produces an analyzed, structured briefing.
 *
 * VALUE PROPOSITION (baked into the prompts):
 *   A public official could just Naver/Google "제주 뉴스". Our differentiator is
 *   NOT raw collection (we can't beat search at that) — it's PROCESSING:
 *     (1) a WIDE net across many Jeju policy axes in one run,
 *     (2) TONE (논조) analysis, not a headline list,
 *     (3) signal vs noise STRUCTURE — big shared issues up top, minor-but-notable
 *         ones briefly below,
 *     (4) NATIONAL vs JEJU-LOCAL press framing contrast.
 *   Honesty: summarize/analyze actual found coverage, cite sources, never fabricate.
 */

/**
 * Search-call cap. This module is far lighter than DEEP (which runs 40–50 calls),
 * but it is STILL a cap, not unlimited. Separate constant — must NOT touch DEEP's
 * own MAX_SEARCHES.
 */
export const MEDIAWATCH_MAX_SEARCHES = 10

/** Token budget per Perplexity umbrella search (concise per-axis summary). */
const SEARCH_MAX_TOKENS = 900

/** Token budget for the single synthesis (anthropic) call — one structured page. */
const SYNTHESIS_MAX_TOKENS = 4000

/** The synthesis brand — strong at careful structuring and tone analysis. */
const SYNTHESIS_PROVIDER: ExtendedAiProviderName = 'anthropic'

/** The search brand — real-time Korean news retrieval. */
const SEARCH_PROVIDER: ExtendedAiProviderName = 'perplexity'

/**
 * Loose policy/interest UMBRELLAS reflecting Jeju's actual priorities. These are
 * broad HINTS, not rigid fixed questions — each becomes ONE Perplexity search.
 * The trailing free-catch entries (isFree) deliberately do NOT force everything
 * into an umbrella, so unexpected issues surface.
 */
const MEDIAWATCH_UMBRELLAS: ReadonlyArray<{
  id: string
  label: string
  hint: string
  isFree?: boolean
}> = [
  {
    id: 'tourism',
    label: '관광 (내국인·외국인)',
    hint: '제주 관광 동향 — 내국인·외국인 관광객 추이, 관광 정책, 관광업계 현안',
  },
  {
    id: 'logistics',
    label: '물류·교통 (항공·항만)',
    hint: '제주 물류·교통 — 항공 노선, 항만, 교통 인프라, 접근성, 운송비',
  },
  {
    id: 'agrifood',
    label: '농수산식품 판매·유통',
    hint: '제주 농수산물·식품 — 생산, 판매·유통, 가격, 수출, 수급',
  },
  {
    id: 'weather',
    label: '날씨·기후',
    hint: '제주 날씨·기후 — 기상특보, 이상기후, 기후변화의 지역 영향',
  },
  {
    id: 'semiconductor',
    label: '반도체 산업',
    hint: '제주 반도체 산업 — 관련 투자, 입지, 정책, 인력',
  },
  {
    id: 'ai-ax',
    label: 'AI·AX 정책',
    hint: '제주 AI·디지털 전환(AX) 정책 — 정부·도지사 역점 사업, 추진 현황',
  },
  {
    id: 'energy',
    label: '친환경에너지·전력',
    hint: '제주 친환경에너지·재생에너지 — 전력 수급, 계통, 출력제한, 정책',
  },
  {
    id: 'free-1',
    label: '그 외 화제 (자유 탐색)',
    hint: '위 분류에 속하지 않더라도 최근 제주에서 가장 화제가 된 일·사건·정책',
    isFree: true,
  },
  {
    id: 'free-2',
    label: '그 외 화제 (자유 탐색 2)',
    hint: '최근 제주도민 사이에서 관심이 높거나 논란이 된 지역 이슈',
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
  /** 전국 vs 제주 지역 언론 논조 대비. */
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
    `당신은 제주 관련 최신 언론 보도를 찾아 정리하는 검색 전문가입니다. 오늘은 ${today}(한국 표준시)입니다.`,
    '주어진 주제 영역에 대해, 가능한 한 최근의 실제 제주 관련 보도를 찾아 한국어로 정리하세요.',
    '각 보도 항목마다 다음을 포함하세요:',
    '- 언론사(매체명)',
    '- 헤드라인 요지: 제목을 그대로 베끼지 말고 의미를 풀어서 쓰세요(직접 인용은 아주 짧게만).',
    '- 보도 날짜: 가능하면 명시하세요. 날짜를 확정할 수 없으면 "날짜 불명" 또는 "최근"/"오래된 기사"로 표시하고 지어내지 마세요.',
    '- 논조(framing): 해당 보도가 사안을 어떻게 프레이밍하는지(긍정/부정/중립, 강조점, 우려).',
    '- 가능하면 출처 URL.',
    '',
    '가능하면 제주 지역언론(제주일보·한라일보·제이누리 등)과 전국 언론을 섞어서 보세요.',
    '규칙(엄수): 실재하지 않는 기사·날짜·수치를 절대 지어내지 마세요. 지지율·찬성률 같은 정량 수치는 만들지 말고, 보도 논조는 정성적으로만 다루세요. 해당 영역의 보도가 적으면 "보도가 적다"고 솔직히 쓰세요.',
  ].join('\n')
}

/** Runs ONE umbrella search via Perplexity. Never throws. */
async function runOneMediaSearch(
  umbrella: { id: string; label: string; hint: string },
  today: string
): Promise<JejuMediaWatchSearch> {
  const query = `${umbrella.hint} — 오늘(${today}) 기준 가장 최근의 제주 관련 보도`
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
      '관점: 일반 제주도민의 시각으로 정리하세요.',
      '"내 지역에 무슨 일이 일어나고 있나"를 중심으로, 생활·체감에 미치는 영향(물가, 교통, 환경, 일상)을 우선하세요.',
      '행정 용어보다 도민이 이해하기 쉬운 표현을 쓰세요.',
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
    `당신은 제주 관련 언론 보도를 종합·분석하는 미디어 분석가입니다. 오늘은 ${today}(한국 표준시)입니다.`,
    '여러 주제 영역에 대해 수집된 실제 보도 자료가 주어집니다. 당신의 가치는 단순 수집이 아니라 "가공"입니다:',
    '- 많이 다뤄진 큰 사안과 적게 다뤄진 사안을 구분(신호 vs 잡음)하고,',
    '- 헤드라인 나열이 아니라 논조(tone)를 분석하며,',
    '- 전국 언론과 제주 지역언론의 프레이밍 차이를 대비합니다.',
    '',
    perspectiveFor(mode),
    '',
    '출력 형식(매우 중요): 오직 하나의 JSON 객체만 출력하세요. 마크다운 코드펜스(```)도, 설명 문장도 쓰지 마세요. 순수 JSON만. 각 값은 한국어 산문/목록 문자열입니다.',
    '스키마:',
    '{',
    '  "summary": "이 브리핑의 최상단 요약 (3~5줄). 오늘 제주 언론 지형의 큰 그림.",',
    '  "coreIssues": "핵심 이슈 — 여러 매체에서 크게 다뤄진 주요 사안들. 각 사안마다 논조 분석과 출처(매체/날짜)를 함께. 가장 비중 있게 작성.",',
    '  "minorIssues": "주변 이슈 — 적게 다뤄졌지만 놓치면 안 될 사안들. 핵심 이슈 아래에 간결한 목록으로.",',
    '  "nationalVsLocal": "전국 언론과 제주 지역언론의 논조가 갈리는 지점. 차이가 뚜렷하지 않으면 그렇다고 명시."',
    '}',
    '',
    '규칙(엄수): 제공된 보도 자료에 근거하세요. 실재하지 않는 기사·수치를 지어내지 마세요. 지지율·찬성률 등 정량 수치를 만들지 말고 논조는 정성적으로만 다루세요. 특정 영역의 보도가 빈약했다면 억지로 채우지 말고 "보도가 적었다"고 솔직히 쓰세요. 출처(매체·날짜)는 가능한 한 보존하여 공무원이 검증할 수 있게 하세요.',
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
    '[수집된 제주 관련 언론 보도 — 주제 영역별]',
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
