import { NextResponse } from 'next/server'

/**
 * 말벗·안부 (companion) dialogue API — stateless per request.
 *
 * Jeju resident senior-mode copy. INDEPENDENT of the care app: this route is a
 * standalone copy (no DB, no region, no shared imports) so the Jeju app and the
 * care app can each change without affecting the other.
 *
 * POST { messages, checkin?, isCheckinSummary? } →
 *   { reply: string, riskLevel: '0' | '1a' | '1b' | '2' | '3' }
 *
 * The client keeps conversation history in React state and passes it on every
 * call; nothing is stored server-side (no DB, no login).
 *
 * ── SAFETY / RESPONSIBLE-AI STANCE (read before changing) ─────────────────────
 * This AI is NOT a counselor and does NOT diagnose. Its safety role is limited
 * to detecting risk signals in what the user says and connecting the person to
 * professional resources (자살예방상담 109) and family. It is an aid to human
 * connection, not a replacement for professional help.
 *
 * RISK CLASSIFICATION — a GRADUATED scale, runs on EVERY user message inside the
 * same Claude call that produces the reply (uses full history for persistence).
 * The response MUST escalate as risk escalates — higher level = stronger, more
 * urgent reply:
 *   0  (normal)   — ordinary chat → warm reply, no resources.
 *   1a (mild)     — light/passing sadness ("외롭다", "재미없다", "사는 게 힘드네"
 *                   in passing) → empathy + caring follow-up ONLY. NO phone
 *                   numbers. First-time mild sadness must NOT show a resource card.
 *   1b (deeper/persistent) — hopelessness ("살고 싶지 않다", "사는 의미가 없다"),
 *                   OR sadness that persists across turns → empathy + gently offer
 *                   109 (24h) / 1577-0199 (24h). 129 is weekday-hours only and is
 *                   NOT mentioned in any crisis path.
 *   2  (ideation, no plan) — suicidal ideation WITHOUT a specific method/plan
 *                   ("죽고 싶다", "생을 마감하고 싶다") → CRISIS MODE (red panel):
 *                   warm non-judgmental support urging 109 + 1577-0199 (both 24h).
 *   3  (imminent/high) — SPECIFIC method, plan, or timing → HIGHEST response:
 *                   hard-refuse method info, urgent immediate-safety check
 *                   ("지금 혼자 계세요?"), strongly urge 109 right now, AND mention
 *                   119 (소방·구급) if the person may be in immediate physical danger.
 *
 * NEVER provide methods or means, at ANY level — hard refusal (see prompt).
 * Over/under-trigger rules: Korean idioms are NOT crisis. Conservative bias:
 * ambiguity resolves UPWARD (0↔1a→1a; near 2→2; 2↔3→3).
 *
 * If the Claude call fails entirely, a conservative keyword check (explicit
 * phrases only) still surfaces crisis resources rather than silently degrading,
 * and detects method/plan language to reach level 3.
 *
 * ⚠️ PHONE NUMBERS — HUMAN VERIFICATION REQUIRED BEFORE DEPLOYMENT:
 *   자살예방상담   109       (24시간; consolidated 2024-01-01)
 *   정신건강상담   1577-0199 (24시간)
 *   소방·구급     119       (level-3 imminent physical danger)
 *   NOTE: 129 (보건복지상담) is weekday 09:00–18:00 ONLY.
 *         It is NOT mentioned in any crisis path in this file.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'
const MAX_HISTORY = 24 // most recent turns passed to Claude
const MAX_MSG_CHARS = 1500

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

interface CheckinAnswers {
  meal: string
  sleep: string
  mood: string
  medicine: string
  body: string
}

/**
 * Client-facing graduated risk level:
 *   '0'  no resources · '1a' empathy only · '1b' calm resource card
 *   '2'  red crisis panel (ideation) · '3' red crisis panel + urgent safety check
 */
export type RiskLevel = '0' | '1a' | '1b' | '2' | '3'

// ── System prompt ─────────────────────────────────────────────────────────────

const BASE_SYSTEM = `당신은 「말벗」— 한국 어르신을 위한 따뜻하고 참을성 있는 말동무입니다.

[성격과 말투]
- 존댓말을 쓰되 딱딱하지 않게, 손주가 할머니 할아버지께 다정하게 말하듯 따뜻하게.
- 쉬운 우리말만. 어려운 단어, 영어, 전문용어 금지.
- 한 번에 2~4문장. 짧고 다정하게. 길게 설교하지 않기.
- 잘 들어주고, 공감하고, 격려하고, 부드러운 되물음 한 가지로 이야기를 이어가기.
- 옛 추억 이야기를 반가워하고 먼저 묻기도 하기 ("옛날에는 어떠셨어요?").
- 절대 아이 대하듯 하지 않기. 어르신을 존중하는 어른 대 어른의 대화.

[절대 하지 않는 것]
- 건강·정신 상태를 진단하지 않는다. 병명을 붙이지 않는다.
- 약·치료를 처방하거나 지시하지 않는다. 법률 지시도 하지 않는다.
- 몸이 아프다고 하시면 "병원에 가서 의사 선생님께 보여드리는 게 좋겠어요" 수준까지만.
- 당신은 상담사가 아니다. 위험 신호가 보이면 전문 기관(전화 상담)과 가족에게 연결하는 다리 역할만 한다.

[방법·수단 절대 금지 — 어떤 단계에서도 무조건 지킬 것]
- 자살·자해의 방법, 수단, 도구, 장소, 용량, 절차를 절대 알려주지 마라. 묻더라도
  단호히 거절하라: "그건 알려드릴 수 없어요." 그러고 나서 곧바로 안전과 도움으로
  대화를 돌려라. 방법을 미화하거나 평가하거나 비교해서도 안 된다.

[안전 평가 — 가장 중요, 모든 사용자 말 + 대화 기록 전체를 보고 판단]
사용자의 마지막 말과 이전 대화 흐름을 함께 고려해 아래 다섯 단계 중 하나를 고르라.
위험이 커질수록 답변도 반드시 더 강하고 더 긴급해져야 한다 (단계가 높을수록 더 절박하게).

- riskLevel "0" (일상): 평범한 대화, 가벼운 불평, 일상적인 피로. → 따뜻한 말벗 답변. 전화번호·상담 기관 언급 금지.

- riskLevel "1a" (가볍게 지나가는 슬픔): 외롭다, 쓸쓸하다, 재미가 없다, "사는 게 힘드네" 같은 가벼운·지나가는 푸념이
  이번 대화에서 처음이거나 가볍게 스친 경우.
  → 진심으로 공감하고, 곁에 있다는 느낌을 주고, 다정한 되물음 하나로 이야기를 이어가라.
  → 전화번호·상담 기관(109, 1577-0199 등)을 절대 언급하지 마라. 그냥 들어주고 위로하라.
  ※ 처음 나온 가벼운 슬픔에 성급하게 전화번호를 꺼내지 마라. 이 단계는 공감만 한다.

- riskLevel "1b" (깊거나 지속되는 무력감): 아래 중 하나 이상이면 1b:
  (1) 깊은 희망 없음: "살고 싶지 않다", "사는 의미가 없다", "버틸 수가 없다", "다 부질없다"
  (2) 같은 슬픔·외로움이 대화에서 여러 차례 반복되거나 점점 깊어짐
  (3) check-in에서 기분이 "힘들어요"였고 대화에서도 계속 힘듦이 이어지는 경우
  → 먼저 진심으로 공감하라. 그 다음 답변 안에서 부드럽게 한 번만 덧붙여라:
              "이런 마음이 드실 때 언제든 얘기 나눌 수 있는 곳이 있어요. 자살예방상담 109(24시간), 정신건강상담 1577-0199예요."
              겁주지 말고 담담하고 다정하게. 129(보건복지상담)는 평일 낮에만 운영하므로 절대 언급하지 마라.

- riskLevel "2" (자살 생각 — 구체적 방법·계획 없음): 죽고 싶다는 생각을 직접 말하지만
  구체적 방법·수단·시점은 없음. 예: "죽고 싶다", "생을 마감하고 싶다", "이제 그만하고 싶다".
  → 놀라거나 훈계하지 말 것. 판단하지 말 것. 곁에 있다는 것, 혼자가 아니라는 것,
  도움을 받을 수 있다는 것을 따뜻하게 전하라.
  자살예방상담 109(24시간)에 지금 전화해 보시라고 부드럽지만 분명하게 권하라.
  도덕적 설교("그런 생각 하시면 안 돼요") 금지. 계속 대화를 이어가며 전화를 권유하라.

- riskLevel "3" (임박·고위험 — 방법·계획·시점): 구체적인 방법·수단을 언급하거나 저울질하고,
  죽는 방법을 묻거나, 계획·시점을 말함.
  예: "목을 맬까 가스를 마실까", "고통 없이 죽는 법", "약을 다 모아놨다", "오늘 밤에 하려고".
  → 이 단계의 답변은 2단계보다 반드시 더 강하고 더 긴급해야 한다 (그러나 따뜻함은 유지).
  (1) 방법 정보는 위 [방법·수단 절대 금지]대로 단호히 거절.
  (2) 지금 당장의 안전을 직접 확인하라: "지금 혼자 계세요? 곁에 누가 있나요?"
  (3) 지금 바로 자살예방상담 109(24시간)에 전화하시라고 강하고 분명하게 권하라 (미루지 말라고).
      정신건강상담 1577-0199도 함께 안내하라.
  (4) 지금 당장 몸이 위험한 상황이거나 이미 행동을 시작했다면 119(소방·구급)에 바로 전화하시라고 명확히 권하라.
  (5) 동시에 가족이나 가까운 이웃에게 지금 즉시 연락하시라고 강하게 권하라. 혼자 있지 마시라고.
  놀라게 하거나 나무라지 말고, 더 절박하지만 더 따뜻하게. 사용자가 "더 심각해졌구나"를 느껴야 한다.

[지속성 판단 — 대화 기록 활용]
- 이전 턴을 보고 슬픔·외로움이 처음인지 반복인지 판단하라.
- 첫 가벼운 슬픔 → 1a. 같은 주제가 이어지거나 더 깊어지면 → 1b.
- check-in 직후 기분 "힘들어요"만으로는 1a (공감만). 대화가 이어져 힘듦이 지속되면 1b.

[오판 방지 + 보수적 상향 — 반드시 지킬 것]
- 한국어 관용 표현은 자살 의도가 아니다: "아이고 죽겠다", "더워 죽겠네",
  "힘들어 죽겠다", "죽도록 힘들다", "배고파 죽겠어" 등은 말버릇이다.
  문맥상 진짜 의도가 보이지 않으면 관용구만으로 절대 2·3으로 판단하지 마라
  (가벼우면 0, 조금 힘들어 보이면 1a).
- 애매할 때는 항상 안전한 쪽(더 높은 단계)으로: 0과 1a 사이 → 1a. 1a와 1b 사이는
  처음/가벼우면 1a, 반복·깊으면 1b. 2에 가까운 애매함("그만 살고 싶다") → 2.
  방법·계획·시점이 조금이라도 비치면 2와 3 사이에서 → 3.

[출력 형식 — 반드시 지킬 것]
마크다운·코드블록·설명 없이 순수 JSON만 출력:
{"riskLevel": "0", "reply": "답변 내용"}
riskLevel 값은 반드시 "0", "1a", "1b", "2", "3" 중 하나.`

/** Extra system context when the user just finished the daily check-in. */
function checkinSystemAddendum(a: CheckinAnswers, isSummaryTurn: boolean): string {
  const lines = [
    '',
    '[오늘의 안부 확인 결과]',
    `- 식사: ${a.meal}`,
    `- 잠: ${a.sleep}`,
    `- 기분: ${a.mood}`,
    `- 약: ${a.medicine}`,
    `- 몸 상태: ${a.body}`,
  ]
  if (isSummaryTurn) {
    lines.push(
      '',
      '[이번 답변 지침 — 안부 확인 직후 인사]',
      '위 답변을 다정하게 한 번 짚어주며 3~4문장으로 인사하라.',
      '- 약을 "안 먹었어요"라면 잊지 말고 챙겨 드시라고 부드럽게 한 번만 상기.',
      '- 잠을 "못 잤어요"라면 낮에 무리하지 말고 쉬어 가시라고 권유.',
      '- 식사를 "아직 못 먹었어요"라면 조금이라도 챙겨 드시라고 다정하게.',
      '- 몸이 "많이 아파요"라면 병원에 가 보시는 게 좋겠다고 권유 (진단 금지).',
      '- 기분이 "힘들어요"라면 공감하고 무슨 일이 있으셨는지 부드럽게 물어보기 (전화번호 언급 금지 → riskLevel "1a").',
      '마지막에 오늘 어떻게 지내셨는지, 이야기 나누고 싶은 것이 있는지 물어라.',
      '진단·처방은 절대 금지. riskLevel은 위 평가 기준대로 (대부분 0, 기분이 힘들면 1a).'
    )
  }
  return lines.join('\n')
}

// ── Parse Claude risk level ───────────────────────────────────────────────────

function normalizeRiskLevel(v: unknown): RiskLevel {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === '3') return '3'
    if (s === '2') return '2'
    if (s === '1b') return '1b'
    if (s === '1a' || s === '1') return '1a' // legacy numeric "1" → mild first
    if (s === '0') return '0'
  }
  // Legacy numeric riskLevel from older prompt versions
  const n = Number(v)
  if (n === 3) return '3'
  if (n === 2) return '2'
  if (n === 1) return '1b'
  return '0'
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude(
  system: string,
  messages: ChatMsg[],
  apiKey: string
): Promise<{ riskLevel: RiskLevel; reply: string } | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system,
        messages,
      }),
    })
    if (!res.ok) {
      console.error(`[companion] anthropic http ${res.status}`)
      return null
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) {
      console.error('[companion] anthropic error:', json.error.message)
      return null
    }
    const raw = json.content?.find((b) => b.type === 'text')?.text ?? ''
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0]) as Record<string, unknown>
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
    if (!reply) return null
    const riskLevel = normalizeRiskLevel(
      parsed.riskLevel ?? parsed.riskTier ?? '0'
    )
    return { riskLevel, reply }
  } catch (e) {
    console.error('[companion] claude call failed:', e instanceof Error ? e.message : e)
    return null
  }
}

// ── Fallback keyword check (ONLY used when the AI call fails) ──────────────────
// Deliberately conservative: explicit phrases only, so an AI outage never hides
// a clear crisis signal, while idioms don't false-trigger a scary screen.

// Level 3 — specific method / plan / timing language. Checked FIRST so an outage
// still escalates the highest-risk case rather than flattening it to level 2.
const METHOD_PLAN_PATTERNS = [
  /죽는\s*(법|방법)/, // 죽는 법/방법
  /고통\s*없이\s*죽/, // 고통 없이 죽는…
  /목.{0,3}(을|를)?\s*(매|맬|맬까|매고|맨)/, // 목을 매/맬까
  /목\s*매/, // 목매다
  /번개탄/,
  /가스.{0,4}(마시|틀|들이)/, // 가스를 마시다/틀다
  /뛰어내리|투신/, // 뛰어내리다/투신
  /약.{0,8}(모아|모았|모으)/, // 약을 모아놨다
  /유서/, // 유서 (writing a note = planning)
  /오늘\s*밤(에)?\s*(할|하려|끝)/, // 오늘 밤에 하려고/끝내려
  /(내일|오늘|이따|밤에).{0,10}(죽|끝내|떠나)/, // timing + intent
]

// Level 2 — explicit suicidal ideation without a specific method/plan.
const EXPLICIT_CRISIS_PATTERNS = [
  /죽고\s*싶/, // 죽고 싶다/싶어요
  /죽어\s*버리/, // 죽어버릴까/죽어버리고
  /자살/,
  /목숨.{0,6}끊/,
  /스스로.{0,6}(해치|끝내)/,
  /생(을|를)?\s*마감/, // 생을 마감하고 싶다
  /그만\s*살/, // 그만 살고 싶다
]

function fallbackRiskLevel(text: string): '0' | '2' | '3' {
  if (METHOD_PLAN_PATTERNS.some((re) => re.test(text))) return '3'
  if (EXPLICIT_CRISIS_PATTERNS.some((re) => re.test(text))) return '2'
  return '0'
}

const FALLBACK_REPLY_NORMAL =
  '죄송해요, 지금 잠깐 연결이 어려워요. 조금 있다가 다시 말씀해 주시겠어요?'
const FALLBACK_REPLY_CRISIS =
  '지금 많이 힘드신 것 같아요. 혼자 계시지 마세요. 자살예방상담 109에 지금 전화하시면 밤낮 언제든 이야기를 들어주는 분이 계세요. 가족에게도 꼭 알려 주세요.'
// Level-3 fallback is deliberately MORE urgent than level 2, and asks about
// immediate safety + family, without providing any method information.
const FALLBACK_REPLY_HIGH =
  '지금 많이 위험한 마음이신 것 같아 걱정돼요. 그건 알려드릴 수 없어요. 지금 혼자 계세요? 곁에 누가 있나요? 지금 바로 자살예방상담 109(24시간)에 전화해 주세요. 정신건강상담 1577-0199도 언제든 받아줘요. 몸이 지금 위험하다면 119에 바로 전화하세요. 그리고 가족이나 가까운 이웃에게도 지금 바로 연락해서 곁에 있어 달라고 하세요. 혼자 계시지 마세요.'

// ── Request parsing ──────────────────────────────────────────────────────────

function parseMessages(v: unknown): ChatMsg[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const out: ChatMsg[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') return null
    const { role, content } = item as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const trimmed = content.trim().slice(0, MAX_MSG_CHARS)
    if (!trimmed) continue
    out.push({ role, content: trimmed })
  }
  if (out.length === 0 || out[out.length - 1]!.role !== 'user') return null
  return out.slice(-MAX_HISTORY)
}

function parseCheckin(v: unknown): CheckinAnswers | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const pick = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).slice(0, 40) : '')
  const a: CheckinAnswers = {
    meal: pick('meal'),
    sleep: pick('sleep'),
    mood: pick('mood'),
    medicine: pick('medicine'),
    body: pick('body'),
  }
  return a.meal || a.sleep || a.mood || a.medicine || a.body ? a : null
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const o = (body ?? {}) as Record<string, unknown>

  const messages = parseMessages(o.messages)
  if (!messages) {
    return NextResponse.json(
      { error: 'messages must be a non-empty array ending with a user turn' },
      { status: 400 }
    )
  }

  const checkin = parseCheckin(o.checkin)
  const isCheckinSummary = o.isCheckinSummary === true

  let system = BASE_SYSTEM
  if (checkin) system += '\n' + checkinSystemAddendum(checkin, isCheckinSummary)

  const result = await callClaude(system, messages, apiKey)

  if (result) {
    return NextResponse.json({ reply: result.reply, riskLevel: result.riskLevel })
  }

  // AI unavailable — conservative keyword fallback so a clear crisis signal
  // still surfaces the 109 resources (and escalates method/plan talk to level 3)
  // instead of a bare error.
  const lastUser = messages[messages.length - 1]!.content
  const fbLevel = fallbackRiskLevel(lastUser)
  const fbReply =
    fbLevel === '3'
      ? FALLBACK_REPLY_HIGH
      : fbLevel === '2'
        ? FALLBACK_REPLY_CRISIS
        : FALLBACK_REPLY_NORMAL
  return NextResponse.json({ reply: fbReply, riskLevel: fbLevel })
}
