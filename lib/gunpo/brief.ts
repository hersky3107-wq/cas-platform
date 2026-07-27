import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { fetchJejuSource } from '@/lib/gunpo/connectors'
import {
  runSingleAiProvider,
  MODEL_BY_PROVIDER,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'

/**
 * Jeju governance briefing engine — LITE mode.
 *
 * DESIGN CONSTRAINTS (same as the rest of lib/jeju):
 *   - May import lib/jeju/connectors.ts and lib/ai/router.ts (runSingleAiProvider).
 *   - MUST NOT touch or depend on app/api/synod/* — this is a small, self-contained
 *     orchestrator, not a reuse of the SYNOD route.
 *   - AIMANI must NOT import lib/jeju. The whole folder stays liftable to a
 *     standalone /jeju site (only lib/extract + lib/ai/router come along).
 *
 * 4-BEAT VISION — this file ships beats 1 + 4:
 *   1. Transparent collection  → gatherJejuSnapshot() (raw data preserved for UI)
 *   2. Role-separated analysis  → (DEEP mode, later)
 *   3. Visible debate           → (DEEP mode, later)
 *   4. One-page summary         → generateJejuLiteBriefing()
 *
 * LITE vs DEEP:
 *   This is LITE mode — single-AI, no debate, fast and shallow. Good for simple
 *   lookups and quick daily briefings. A future DEEP mode (multi-AI debate, role
 *   separation, minority report) will be built ON TOP of the SAME data layer, so
 *   gatherJejuSnapshot() and buildBriefingContext() are kept MODE-AGNOSTIC and
 *   will be reused unchanged by DEEP.
 *
 * TWO TIERS, ONE PIPELINE:
 *   The engine serves both senior officials (general daily briefing) and
 *   working-level staff (specific planning/forecast questions) from day one. The
 *   ONLY difference is the input question; the collection + context + prompt
 *   pipeline is identical.
 */

/**
 * GUNPO top-level council mode. STILL 'trade' | 'warroom' internally (unchanged
 * identifier/values — see components/gunpo/mode-context.tsx's GunpoMode for the
 * UI-facing 'urban' | 'people' values). Wiring 'trade'→도시·정비 and
 * 'warroom'→시민·정주 through this file is a later step.
 */
export type JejuCouncilMode = 'trade' | 'warroom'

/**
 * TODO(군포): 도시·정비(trade) 축에서 실제로 쓸 lib/gunpo/connectors.ts 소스
 * id들을 채울 것. 원본(motie)의 TRADE_SOURCE_IDS는 KOTRA/환율(수출 전용)이라 전부
 * 삭제됐다 — 지금 lib/gunpo/connectors.ts에 남아있는 것은 kamis-gunpo-products /
 * kma-gunpo-weather / kma-gunpo-midterm / kma-gunpo-warning / keco-gunpo-evcharger
 * 5개뿐이니 그중 이 축에 맞는 것을 고르면 된다.
 */
const TRADE_SOURCE_IDS: readonly string[] = []

/**
 * TODO(군포): 시민·정주(warroom) 축에서 실제로 쓸 lib/gunpo/connectors.ts 소스
 * id들을 채울 것. 원본(motie)의 WARROOM_SOURCE_IDS(오피넷/KPX/가스공사)는 지역
 * 파라미터가 없는 전국 집계라 이번 단계에서 보류됐다 — 되살리려면 connectors.ts에
 * 다시 등록부터 해야 한다.
 */
const WARROOM_SOURCE_IDS: readonly string[] = []

/** Resolves the source-id list for a given council mode. */
function sourceIdsForMode(councilMode: JejuCouncilMode): readonly string[] {
  return councilMode === 'trade' ? TRADE_SOURCE_IDS : WARROOM_SOURCE_IDS
}

/**
 * Korean section header per source id, used by buildBriefingContext.
 * TODO(군포): TRADE_SOURCE_IDS/WARROOM_SOURCE_IDS를 채우면 여기도 그 id들에 맞는
 * 헤더로 채울 것 (비워두면 buildBriefingContext가 `## ${label}`로 안전하게 폴백함).
 */
const SECTION_HEADER_BY_ID: Record<string, string> = {}

/** Effective question used when no specific question is supplied (daily path). */
const DEFAULT_DAILY_QUESTION = ''

/**
 * Standing 군포 context for the TRADE axis (도시·정비) — injected into every
 * briefing (LITE + DEEP). Identifier kept as JEJU_STANDING_ECONOMY_CONTEXT for
 * import-stability (deep.ts imports this name); the value is the
 * STEP6-provided GUNPO_STANDING_URBAN_CONTEXT, copied verbatim.
 */
export const JEJU_STANDING_ECONOMY_CONTEXT = `군포시는 경기도 남부의 중소도시다. 1990년대 초 입주한 산본 1기 신도시와 군포역·금정역 일대 원도심이 동시에 노후화 국면에 들어섰다.
금정역은 수도권 1호선·4호선 환승역이며 GTX-C 정차역으로 계획돼 있다. 남·북부 역사 통합과 복합환승센터를 포함한 역세권 개발이 추진 중이나, 국토교통부·한국철도공사·GTX 사업시행자 등 다수 기관 협의가 필요해 시가 단독으로 시기를 결정할 수 없다.
당정동 일대 노후 공업지역은 첨단산업·주거·문화 복합지구로 전환이 추진 중이다. 동시에 산본·평촌 재정비에 따른 이주수요를 흡수할 주택 공급도 같은 부지에 예정돼 있어, 자족 산업거점 목표와 이주주택 공급 목표가 한정된 면적을 두고 경합한다.
부곡동 군포복합물류터미널은 화물차 통행·소음·생활권 단절 문제가 지속돼 왔다. 부지는 국토교통부 소유이며 민간 운영 방식이어서 시가 단독으로 이전이나 기능전환을 결정할 수 없다.
산본천 복원 사업은 국비 확보에 차질이 있어 재원 대책이 쟁점이다.
산본1동을 비롯한 저지대는 집중호우 시 침수 이력이 있고, 침수감지·급경사지 위험감지 체계가 운영되고 있다.
시 재정은 자체수입 증가가 제한적이고 의무지출 비중이 높아 가용재원이 좁다. 따라서 신규 사업은 규모보다 재원 조달 방식과 우선순위가 항상 쟁점이 된다.`

/**
 * Standing context for the WARROOM axis (시민·정주). Identifier kept as
 * WARROOM_STANDING_ENERGY_CONTEXT for import-stability (deep.ts imports this
 * name); the value is the STEP6-provided GUNPO_STANDING_PEOPLE_CONTEXT,
 * copied verbatim.
 */
export const WARROOM_STANDING_ENERGY_CONTEXT = `군포시는 인구 감소와 청년층 유출이 동시에 진행되고 있다. 주거·일자리·보육·문화 등 정주 여건에서 인접 대도시와 경쟁하는 위치에 있다.
신도시 노후화로 세대·계층별 생활 여건 격차가 벌어지고 있으며, 돌봄과 기본생활 정책은 현금성 지원 단일 수단보다 주거·일자리·시민참여와 연계되는 구조가 요구된다.
생활안전(침수, 급경사지, 보행·교통 환경)은 시민 체감도가 높은 영역이다.`

/** Korean uses ~2-3x more tokens than English; one page needs headroom. */
const BRIEFING_MAX_TOKENS = 4000

/** One source's collected result, raw text preserved for transparent display. */
export type JejuSnapshotSource = {
  id: string
  label: string
  ok: boolean
  text: string
  error?: string
}

/** Result of the transparent-collection layer (beat 1). */
export type JejuSnapshot = {
  /** True if AT LEAST ONE source succeeded. */
  ok: boolean
  sources: JejuSnapshotSource[]
}

/** Full LITE briefing result (beats 1 + 4): briefing text AND raw snapshot. */
export type JejuBriefingResult = {
  ok: boolean
  /** The effective question answered (the supplied one, or the daily default). */
  question: string
  snapshot: JejuSnapshot
  briefing: string | null
  provider: string
  error?: string
}

/**
 * BEAT 1 — transparent collection.
 *
 * Fetches all three governance sources in parallel and returns each one's
 * id/label/ok/text(or error), preserving raw data so the UI can SHOW exactly
 * what was collected. Never throws; a rejected fetch becomes an ok:false entry.
 * Snapshot ok=true when ≥1 source succeeded.
 *
 * MODE-AGNOSTIC: both LITE and (future) DEEP modes consume this unchanged.
 */
export async function gatherJejuSnapshot(
  councilMode: JejuCouncilMode = 'warroom'
): Promise<JejuSnapshot> {
  const ids = sourceIdsForMode(councilMode)
  const settled = await Promise.allSettled(ids.map((id) => fetchJejuSource(id)))

  const sources: JejuSnapshotSource[] = settled.map((res, i) => {
    const id = ids[i]!
    if (res.status === 'fulfilled') {
      const content = res.value
      return {
        id,
        label: content.title ?? id,
        ok: content.ok,
        text: content.text,
        ...(content.ok ? {} : { error: content.error ?? 'unknown error' }),
      }
    }
    return {
      id,
      label: id,
      ok: false,
      text: '',
      error: res.reason instanceof Error ? res.reason.message : 'fetch rejected',
    }
  })

  return { ok: sources.some((s) => s.ok), sources }
}

/**
 * Assembles successful sources' text into one structured Korean string with
 * per-axis section headers. Failed/empty sources are EXPLICITLY listed so the AI
 * knows the data is partial and can say so rather than fabricate.
 *
 * MODE-AGNOSTIC: shared by LITE and (future) DEEP.
 */
export function buildBriefingContext(
  snapshot: JejuSnapshot,
  councilMode: JejuCouncilMode = 'warroom'
): string {
  const sections: string[] = []
  const failed: string[] = []

  for (const s of snapshot.sources) {
    const header = SECTION_HEADER_BY_ID[s.id] ?? `## ${s.label}`
    if (s.ok && s.text.trim()) {
      sections.push(`${header}\n${s.text.trim()}`)
    } else {
      failed.push(`- ${s.label} (${s.id}): ${s.error ?? '데이터 없음'}`)
    }
  }

  const parts: string[] = []
  // Standing context is mode-specific. TRADE omits it here (a trade-specific
  // standing context lives in the prompt layer); WARROOM injects the energy-
  // security context so fuel + LNG are read as one import-dependent picture.
  if (councilMode === 'warroom' && WARROOM_STANDING_ENERGY_CONTEXT.trim()) {
    parts.push(`## 시민·정주 상시 맥락\n${WARROOM_STANDING_ENERGY_CONTEXT}`)
  }
  parts.push(sections.length ? sections.join('\n\n') : '(수집된 데이터가 없습니다.)')
  if (failed.length) {
    parts.push(`## 수집 실패 소스 (데이터 일부 누락)\n${failed.join('\n')}`)
  }
  return parts.join('\n\n')
}

/**
 * The Jeju governance advisor system prompt (보좌 역할, NOT decision-maker).
 * Demands a one-page Korean briefing that CONNECTS the climate→agriculture→energy
 * axes instead of listing them, in a fixed 4-section structure, grounded ONLY in
 * the provided data.
 */
function buildSystemPrompt(): string {
  return [
    '당신은 군포시정을 돕는 거버넌스 데이터 분석 보좌역(advisor)입니다.',
    '당신의 역할은 의사결정자가 아니라 보좌입니다 — 최종 결정은 사람이 내립니다 ("AI가 보좌").',
    '',
    '제공된 데이터만을 근거로, 한 페이지 분량의 직관적인 한국어 브리핑을 작성하세요.',
    '핵심은 각 축(도시·정비 ↔ 시민·정주)을 단순히 나열하지 말고, 서로 연결하여 해석하는 것입니다.',
    '',
    '반드시 다음 4개 섹션 구조를 따르세요:',
    '1. 핵심 요약 (3줄): 가장 중요한 메시지 3줄.',
    '2. 분석: 축 간 연결 관계와 현황·예측. 데이터가 서로 어떻게 영향을 주고받는지 설명.',
    '3. 추천: 실행 가능한 구체적 제언.',
    '4. 참고: 데이터 시점·출처, 그리고 수집에 실패했거나 누락된 소스를 명시.',
    '',
    '규칙(엄수):',
    '- 오직 제공된 데이터에만 근거하세요. 데이터에 없는 수치를 절대 지어내지 마세요.',
    '- 데이터가 없거나 질문에 데이터로 답할 수 없으면, 그 사실을 솔직하게 명시하세요. 추측으로 메우지 마세요.',
    '- 숫자를 인용할 때는 제공된 데이터의 값만 사용하세요.',
    '- 부동산 가격 예측, 특정 사업에 대한 여론 추정, 정치적 유불리 평가는 하지 않는다.',
    '- 제시되지 않은 수치를 쓸 경우 반드시 [AI 추정]으로 명시한다.',
    '- 시가 단독으로 결정할 수 없는 사안은 협의 상대와 제약 조건을 함께 밝힌다.',
    '- 결론에는 3개월 내 착수 가능한 조치와 장기 과제를 구분해 제시한다.',
    '- 당신은 보좌 역할이며, 최종 판단과 결정은 담당 공무원(사람)의 몫임을 브리핑 끝에 상기시키세요.',
  ].join('\n')
}

/** Resolves a provider string to a valid router provider, defaulting to anthropic. */
function resolveProvider(p?: string): ExtendedAiProviderName {
  if (p && Object.prototype.hasOwnProperty.call(MODEL_BY_PROVIDER, p)) {
    return p as ExtendedAiProviderName
  }
  return 'anthropic'
}

/**
 * A throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * Because we pass sessionId:null and userId:null, the router performs NO DB
 * inserts and NO BYOK reads — this client is never dereferenced for I/O. Keeping
 * it local (vs importing a real admin client) preserves lib/jeju's portability.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'lite-mode-no-db') as unknown as SupabaseClient
}

/**
 * BEAT 4 — one-page summary (LITE mode).
 *
 * If `params.question` is provided → answers THAT specific question
 * (working-level staff path: planning/forecasting). If omitted → produces the
 * general daily briefing (senior-official path). The effective question is stored
 * in the return value. The pipeline is identical for both tiers.
 *
 * Pipeline: gatherJejuSnapshot() → buildBriefingContext() → runSingleAiProvider()
 * (provider defaults to 'anthropic', sessionId:null/userId:null — no DB/credits).
 *
 * Returns the briefing text AND the raw snapshot so the UI can show both
 * (transparent collection + summary). Never throws — failures return ok:false.
 */
export async function generateJejuLiteBriefing(params?: {
  question?: string
  provider?: string
  councilMode?: JejuCouncilMode
}): Promise<JejuBriefingResult> {
  const question = params?.question?.trim() || DEFAULT_DAILY_QUESTION
  const provider = resolveProvider(params?.provider)
  const councilMode: JejuCouncilMode = params?.councilMode ?? 'warroom'

  let snapshot: JejuSnapshot
  try {
    snapshot = await gatherJejuSnapshot(councilMode)
  } catch (e: unknown) {
    // gatherJejuSnapshot is designed not to throw, but guard anyway.
    return {
      ok: false,
      question,
      snapshot: { ok: false, sources: [] },
      briefing: null,
      provider,
      error: `데이터 수집 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (!snapshot.ok) {
    return {
      ok: false,
      question,
      snapshot,
      briefing: null,
      provider,
      error: '모든 데이터 소스 수집에 실패했습니다 (브리핑 생성 불가).',
    }
  }

  const context = buildBriefingContext(snapshot, councilMode)
  const userPrompt = [
    '[요청]',
    question,
    '',
    '[수집 데이터]',
    context,
  ].join('\n')

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider,
      prompt: userPrompt,
      systemPrompt: buildSystemPrompt(),
      maxCompletionTokens: BRIEFING_MAX_TOKENS,
    })

    if (r.error || !r.text) {
      return {
        ok: false,
        question,
        snapshot,
        briefing: null,
        provider,
        error: r.error ?? 'AI가 빈 응답을 반환했습니다.',
      }
    }

    return { ok: true, question, snapshot, briefing: r.text, provider }
  } catch (e: unknown) {
    return {
      ok: false,
      question,
      snapshot,
      briefing: null,
      provider,
      error: `브리핑 생성 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

/**
 * Back-compat alias. The canonical name is generateJejuLiteBriefing (LITE mode);
 * a future generateJejuDeepBriefing will sit beside it. Prefer the explicit name.
 */
export const generateJejuBriefing = generateJejuLiteBriefing
