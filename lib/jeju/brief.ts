import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { fetchJejuSource } from '@/lib/jeju/connectors'
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

/** The four governance-axis sources: energy, agriculture/marine, climate, forecast. */
const GOVERNANCE_SOURCE_IDS = [
  'kpx-jeju-power',
  'kamis-jeju-products',
  'kma-jeju-weather',
  'kma-jeju-midterm',
  'kpx-jeju-smp',
  'kma-jeju-warning',
  'keco-jeju-evcharger',
  'jeju-citrus-production',
  'jeju-cargo-throughput',
  'jeju-foreign-tourists',
  'jeju-domestic-tourists',
] as const

/** Korean section header per source id, used by buildBriefingContext. */
const SECTION_HEADER_BY_ID: Record<string, string> = {
  'kpx-jeju-power': '## 제주 전력 현황 (KPX)',
  'kamis-jeju-products': '## 제주 농수산물 가격 (KAMIS)',
  'kma-jeju-weather': '## 제주 기상 현황 (KMA)',
  'kma-jeju-midterm': '## 제주 중기예보 11일 전망 (KMA)',
  'kpx-jeju-smp': '## 제주 계통한계가격·수요예측 (KPX SMP)',
  'kma-jeju-warning': '## 제주 기상특보 (KMA)',
  'keco-jeju-evcharger': '## 제주 전기차 충전 인프라 (환경부/KECO)',
  'jeju-citrus-production': '## 제주 감귤 생산현황',
  'jeju-cargo-throughput': '## 제주 항만 물동량',
  'jeju-foreign-tourists': '## 제주 외국인 관광객 현황',
  'jeju-domestic-tourists': '## 제주 내국인 관광객 현황',
}

/** Effective question used when no specific question is supplied (daily path). */
const DEFAULT_DAILY_QUESTION = '오늘의 제주 거버넌스 브리핑'

/**
 * Standing Jeju economy context — injected into every briefing (LITE + DEEP).
 * Covers 반도체 (no public API → search for updates), 관광, 감귤 so orchestrator
 * and experts treat semiconductor as a top export pillar despite no dedicated source.
 */
export const JEJU_STANDING_ECONOMY_CONTEXT =
  '제주 3대 핵심 산업: ① 반도체(제주 수출 1위 품목, 전체 수출의 50% 이상 — 제주반도체㈜ 글로벌 스타팹리스, 5G IoT·전장용 저전력 메모리. 단 생산 통계 공공API는 없으므로 반도체 관련 사안은 검색(Perplexity)으로 최신 수출·실적 동향을 확인할 것) ② 관광(외국인 연 190만·중국 의존 72%, 내국인 연 1186만) ③ 감귤(농업 상징).'

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
export async function gatherJejuSnapshot(): Promise<JejuSnapshot> {
  const settled = await Promise.allSettled(
    GOVERNANCE_SOURCE_IDS.map((id) => fetchJejuSource(id))
  )

  const sources: JejuSnapshotSource[] = settled.map((res, i) => {
    const id = GOVERNANCE_SOURCE_IDS[i]!
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
export function buildBriefingContext(snapshot: JejuSnapshot): string {
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
  parts.push(`## 제주 핵심 산업 맥락 (상시)\n${JEJU_STANDING_ECONOMY_CONTEXT}`)
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
    '당신은 제주특별자치도정을 돕는 거버넌스 데이터 분석 보좌역(advisor)입니다.',
    '당신의 역할은 의사결정자가 아니라 보좌입니다 — 최종 결정은 사람이 내립니다 ("AI가 보좌").',
    '',
    '제공된 데이터만을 근거로, 한 페이지 분량의 직관적인 한국어 브리핑을 작성하세요.',
    '핵심은 각 축(기후 → 농업 → 에너지)을 단순히 나열하지 말고, 서로 연결하여 해석하는 것입니다.',
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
}): Promise<JejuBriefingResult> {
  const question = params?.question?.trim() || DEFAULT_DAILY_QUESTION
  const provider = resolveProvider(params?.provider)

  let snapshot: JejuSnapshot
  try {
    snapshot = await gatherJejuSnapshot()
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

  const context = buildBriefingContext(snapshot)
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
