/**
 * lib/jeju/fishing-floor.ts
 *
 * PURE — no 'server-only', no Supabase, no AI client, no Next.js imports.
 * Contains only the deterministic safety-floor types and functions that must
 * be unit-testable standalone (e.g. from scripts/verify-fishing-decision.ts).
 *
 * Both lib/jeju/fishing-decision.ts (server-only compute) and the verify
 * script import from here.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type Verdict = '나가도 좋음' | '주의' | '오늘은 접자'

export interface FishingDecision {
  verdict: Verdict
  headline: string
  reasons: string[]
  priceNote: string
  safetyNote: string
}

export interface SafetyFloor {
  /** When true, verdict is forced to "오늘은 접자" regardless of what the AI says. */
  forced: boolean
  reasons: string[]
}

/**
 * Minimal marine shape required by the floor functions.
 * Structurally compatible with MarineSummary in fishing-decision.ts so it can
 * be passed directly without casting.
 */
export interface MarineFloorInput {
  waveHeightM: number | null
  warnings: Array<{ type: string; level: string }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WAVE_DANGER_M = 2.0
const DANGER_WARNING_TYPES = ['풍랑', '태풍', '폭풍해일']
const VERDICTS: Verdict[] = ['나가도 좋음', '주의', '오늘은 접자']

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Severity ranking: higher index = more restrictive. */
export function verdictRank(v: Verdict): number {
  return VERDICTS.indexOf(v)
}

// ── Core safety-floor functions ───────────────────────────────────────────────

/**
 * Compute the deterministic safety floor from marine data.
 * DANGER conditions (force "오늘은 접자"):
 *   - 풍랑/태풍/폭풍해일 경보 active
 *   - 파고 ≥ 2.0m
 * This runs in code before AND after the AI call — the model cannot override it.
 */
export function computeSafetyFloor(marine: MarineFloorInput): SafetyFloor {
  const reasons: string[] = []

  const dangerWarnings = marine.warnings.filter(
    (w) => w.level === '경보' && DANGER_WARNING_TYPES.some((t) => w.type.includes(t)),
  )
  for (const w of dangerWarnings) {
    reasons.push(`${w.type}${w.level} 발효 중`)
  }

  if (marine.waveHeightM != null && marine.waveHeightM >= WAVE_DANGER_M) {
    reasons.push(`파고 ${marine.waveHeightM.toFixed(1)}m (2.0m 이상)`)
  }

  return { forced: reasons.length > 0, reasons }
}

/**
 * Clamp an AI-proposed decision to the safety floor.
 * If floor.forced is true, verdict is unconditionally set to "오늘은 접자"
 * and the floor reasons are prepended to the decision's reasons list.
 * The AI can NEVER produce a less-restrictive verdict when the floor is active.
 */
export function clampToFloor(decision: FishingDecision, floor: SafetyFloor): FishingDecision {
  if (floor.forced && decision.verdict !== '오늘은 접자') {
    return {
      ...decision,
      verdict: '오늘은 접자',
      headline:
        decision.headline && verdictRank(decision.verdict) >= verdictRank('주의')
          ? decision.headline
          : '풍랑·높은 파도로 오늘은 바다가 위험해요.',
      reasons: Array.from(new Set([...floor.reasons, ...decision.reasons])).slice(0, 4),
    }
  }
  return decision
}
