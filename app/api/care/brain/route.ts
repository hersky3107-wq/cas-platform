import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * 오늘의 뇌 운동 — daily elderly-friendly cognitive exercise (national copy).
 *
 * COPIED from app/api/jeju/resident/brain. Still uses the `jeju_resident_brain`
 * cache table (a national table comes in a later step).
 *
 * Cache key is `YYYY-MM-DD-<level>` in `jeju_resident_brain.day`, so each
 * difficulty level caches independently under the existing unique constraint.
 * GET ?level=easy|normal|hard  (default: normal).
 *
 * FRAMING: light "뇌 운동 / 머리 맑게" fun, NOT a medical tool. Never claim
 * to prevent or cure dementia. Warm, unambiguous questions.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

type Domain = 'memory' | 'attention' | 'language' | 'category' | 'calculation' | 'knowledge'
type Level = 'easy' | 'normal' | 'hard'

interface BrainQuestion {
  domain: Domain
  question: string
  choices: string[]
  answerIndex: number
  explanation: string
  memoryPrep?: string
}

// ── KST day key ─────────────────────────────────────────────────────────────

function kstDay(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ── small utils ───────────────────────────────────────────────────────────────

/** Deterministic non-crypto string hash → non-negative int (for daily rotation). */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

// ── Proverb (속담) whitelist ─────────────────────────────────────────────────
//
// Proverb questions are NOT freely invented by the AI (it once produced a wrong
// proverb whose answer wasn't even a choice). Instead we PICK from this vetted
// list, blank the key word, and build the 4-choice question from the stored
// answer + distractors — guaranteeing the proverb is real and the correct
// answer is present. Rotation is seeded by day+level so it varies.

interface Proverb {
  /** Full correct proverb. */
  proverb: string
  /** Exact substring of `proverb` to blank out (must be unique within it). */
  blankable: string
  /** Correct word/phrase (== blankable). */
  answer: string
  /** 3 plausible-but-clearly-wrong words. */
  distractors: [string, string, string]
}

const PROVERBS: Proverb[] = [
  { proverb: '가는 말이 고와야 오는 말이 곱다', blankable: '곱다', answer: '곱다', distractors: ['거칠다', '사납다', '밉다'] },
  { proverb: '구더기 무서워 장 못 담글까', blankable: '구더기', answer: '구더기', distractors: ['파리', '벌레', '쥐'] },
  { proverb: '티끌 모아 태산', blankable: '태산', answer: '태산', distractors: ['언덕', '모래', '바람'] },
  { proverb: '낮말은 새가 듣고 밤말은 쥐가 듣는다', blankable: '쥐', answer: '쥐', distractors: ['개', '소', '닭'] },
  { proverb: '백지장도 맞들면 낫다', blankable: '낫다', answer: '낫다', distractors: ['무겁다', '어렵다', '같다'] },
  { proverb: '소 잃고 외양간 고친다', blankable: '외양간', answer: '외양간', distractors: ['대문', '지붕', '울타리'] },
  { proverb: '우물 안 개구리', blankable: '개구리', answer: '개구리', distractors: ['물고기', '올챙이', '두꺼비'] },
  { proverb: '등잔 밑이 어둡다', blankable: '어둡다', answer: '어둡다', distractors: ['밝다', '환하다', '좁다'] },
  { proverb: '발 없는 말이 천리 간다', blankable: '천리', answer: '천리', distractors: ['백리', '십리', '오리'] },
  { proverb: '원숭이도 나무에서 떨어진다', blankable: '나무', answer: '나무', distractors: ['절벽', '지붕', '하늘'] },
  { proverb: '하늘의 별 따기', blankable: '별', answer: '별', distractors: ['달', '구름', '해'] },
  { proverb: '개천에서 용 난다', blankable: '용', answer: '용', distractors: ['뱀', '물고기', '이무기'] },
  { proverb: '고래 싸움에 새우 등 터진다', blankable: '새우', answer: '새우', distractors: ['거북', '조개', '게'] },
  { proverb: '가재는 게 편', blankable: '게', answer: '게', distractors: ['새우', '물고기', '조개'] },
  { proverb: '까마귀 날자 배 떨어진다', blankable: '배', answer: '배', distractors: ['감', '밤', '돌'] },
  { proverb: '낫 놓고 기역 자도 모른다', blankable: '기역', answer: '기역', distractors: ['니은', '디귿', '미음'] },
  { proverb: '남의 떡이 더 커 보인다', blankable: '떡', answer: '떡', distractors: ['밥', '집', '돈'] },
  { proverb: '돌다리도 두들겨 보고 건너라', blankable: '두들겨', answer: '두들겨', distractors: ['살펴', '돌아', '비켜'] },
  { proverb: '되로 주고 말로 받는다', blankable: '말', answer: '말', distractors: ['됫박', '자루', '섬'] },
  { proverb: '뛰는 놈 위에 나는 놈 있다', blankable: '나는', answer: '나는', distractors: ['걷는', '자는', '우는'] },
  { proverb: '말 한마디에 천 냥 빚도 갚는다', blankable: '천 냥', answer: '천 냥', distractors: ['백 냥', '만 냥', '열 냥'] },
  { proverb: '목마른 사람이 우물 판다', blankable: '우물', answer: '우물', distractors: ['땅', '밭', '도랑'] },
  { proverb: '바늘 도둑이 소도둑 된다', blankable: '소도둑', answer: '소도둑', distractors: ['부자', '거지', '장사꾼'] },
  { proverb: '배보다 배꼽이 더 크다', blankable: '배꼽', answer: '배꼽', distractors: ['다리', '머리', '손'] },
  { proverb: '벼는 익을수록 고개를 숙인다', blankable: '고개', answer: '고개', distractors: ['허리', '팔', '무릎'] },
  { proverb: '빈 수레가 요란하다', blankable: '요란하다', answer: '요란하다', distractors: ['무겁다', '느리다', '조용하다'] },
  { proverb: '서당 개 삼 년이면 풍월을 읊는다', blankable: '삼 년', answer: '삼 년', distractors: ['십 년', '일 년', '한 달'] },
  { proverb: '세 살 버릇 여든까지 간다', blankable: '여든', answer: '여든', distractors: ['예순', '백 살', '마흔'] },
  { proverb: '수박 겉 핥기', blankable: '수박', answer: '수박', distractors: ['참외', '호박', '사과'] },
  { proverb: '아니 땐 굴뚝에 연기 날까', blankable: '굴뚝', answer: '굴뚝', distractors: ['아궁이', '부뚜막', '화로'] },
  { proverb: '열 번 찍어 아니 넘어가는 나무 없다', blankable: '열 번', answer: '열 번', distractors: ['한 번', '백 번', '세 번'] },
  { proverb: '우는 아이 젖 준다', blankable: '젖', answer: '젖', distractors: ['밥', '떡', '물'] },
  { proverb: '원수는 외나무다리에서 만난다', blankable: '외나무다리', answer: '외나무다리', distractors: ['장터', '고갯길', '나루터'] },
  { proverb: '지렁이도 밟으면 꿈틀한다', blankable: '지렁이', answer: '지렁이', distractors: ['개미', '달팽이', '벌레'] },
  { proverb: '천 리 길도 한 걸음부터', blankable: '한 걸음', answer: '한 걸음', distractors: ['첫 발', '지도', '준비'] },
  { proverb: '하룻강아지 범 무서운 줄 모른다', blankable: '범', answer: '범', distractors: ['개', '소', '늑대'] },
  { proverb: '호랑이도 제 말 하면 온다', blankable: '호랑이', answer: '호랑이', distractors: ['귀신', '도둑', '손님'] },
  { proverb: '가랑비에 옷 젖는 줄 모른다', blankable: '가랑비', answer: '가랑비', distractors: ['소나기', '이슬', '안개'] },
  { proverb: '금강산도 식후경', blankable: '식후경', answer: '식후경', distractors: ['구경거리', '단풍철', '봄나들이'] },
  { proverb: '믿는 도끼에 발등 찍힌다', blankable: '도끼', answer: '도끼', distractors: ['칼', '낫', '망치'] },
  { proverb: '사공이 많으면 배가 산으로 간다', blankable: '산', answer: '산', distractors: ['강', '바다', '뭍'] },
  { proverb: '우물을 파도 한 우물을 파라', blankable: '한 우물', answer: '한 우물', distractors: ['깊은 우물', '여러 우물', '넓은 우물'] },
  { proverb: '웃는 낯에 침 못 뱉는다', blankable: '침', answer: '침', distractors: ['말', '돌', '화'] },
  { proverb: '종로에서 뺨 맞고 한강에서 눈 흘긴다', blankable: '한강', answer: '한강', distractors: ['동네', '시장', '집'] },
  { proverb: '개똥도 약에 쓰려면 없다', blankable: '약', answer: '약', distractors: ['밭', '불', '물'] },
  { proverb: '꿩 대신 닭', blankable: '닭', answer: '닭', distractors: ['오리', '소', '돼지'] },
  { proverb: '도토리 키 재기', blankable: '도토리', answer: '도토리', distractors: ['밤', '콩', '감자'] },
  { proverb: '미운 놈 떡 하나 더 준다', blankable: '떡', answer: '떡', distractors: ['밥', '돈', '매'] },
]

/**
 * Build a guaranteed-correct 속담 question from the whitelist. Rotation is
 * seeded by `seedKey` (day+level) so it varies day to day and per difficulty,
 * while choice order is randomized (result is cached, so this is stable once
 * generated). The correct answer is always one of the choices.
 */
function buildProverbQuestion(seedKey: string): BrainQuestion {
  const p = PROVERBS[hashString(seedKey) % PROVERBS.length]!
  const blanked = p.proverb.replace(p.blankable, '____')
  const choices = shuffle([p.answer, ...p.distractors])
  const answerIndex = choices.indexOf(p.answer)
  return {
    domain: 'language',
    question: `빈칸에 알맞은 말은 무엇일까요?\n\n"${blanked}"`,
    choices,
    answerIndex,
    explanation: `정답은 "${p.answer}"입니다. 원래 속담은 "${p.proverb}"예요.`,
  }
}

// ── Claude helper ────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string, apiKey: string, maxTokens = 3000): Promise<string | null> {
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
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) {
      console.error(`[brain] anthropic http ${res.status}`)
      return null
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)
    return json.content?.find((b) => b.type === 'text')?.text ?? ''
  } catch (e) {
    console.error('[brain] claude call failed:', e instanceof Error ? e.message : e)
    return null
  }
}

// ── Level-aware generation prompt ─────────────────────────────────────────────

const LEVEL_INSTRUCTIONS: Record<Level, string> = {
  easy: `【난이도: 쉬워요】
- 아주 짧고 간단한 낱말/문장으로 구성하세요.
- 정답이 한눈에 보일 정도로 쉽고 명확한 보기.
- 속담은 마지막 한두 글자만 빈칸. 계산은 1단계(덧셈 또는 작은 곱셈).
- 상식 문제는 일상적으로 아주 잘 아는 소재만.`,
  normal: `【난이도: 보통이에요】
- 약간 더 긴 속담(중간 부분 빈칸 가능). 계산은 2단계(두 종류 물건 합산 등).
- 보기 중 헷갈릴 만한 것 1개 정도 포함(단, 정답은 명확).
- 상식 문제는 옛날 생활, 제주 상식, 생활·안전, 가벼운 시사 중 혼합.`,
  hard: `【난이도: 어려워요】
- 속담 처음부분 또는 중간을 빈칸으로 하거나 의미 파악 필요. 비슷한 보기 허용.
- 계산은 2~3단계(여러 물건 가격 계산, 거스름돈 포함 가능).
- 상식: 더 깊은 제주 지식, 옛 생활 상식 심화, 가벼운 시사 상식.
- 기억력: 낱말을 4개로 늘리거나 낱말이 길어질 수 있음.
- 여전히 한 가지 명확한 정답. 여전히 따뜻한 어조.`,
}

const KNOWLEDGE_GUIDE = `knowledge(회상·상식) 문제는 매번 다음 4가지 소재를 고르게 섞어서 내세요(한 세트에 1~2개):
- 옛날 생활 상식/추억: 옛날 생활 도구·음식·풍습 (예: 방망이, 두레박, 가마솥, 전기 없던 시절 등)
- 생활·안전 상식: 건강·안전·응급상황 기초 지식 (예: "뜨거운 것에 데었을 때 가장 먼저 할 일은?", "눈이 쌓인 길에서 넘어지지 않으려면?")
- 제주 관련 상식: 제주 지리·문화·음식·자랑거리 (예: "제주의 상징 돌하르방은 어떤 돌로 만들었나요?", "한라산은 어느 도에 있나요?")
- 가벼운 시사 상식: 비정치적·비논쟁적인 일반 상식 (예: "올림픽은 몇 년에 한 번 열리나요?", "세계에서 제일 높은 산은?")

★ 상식 문제 안전 규칙(매우 중요) — 상식 문제는 프로그램이 정답을 검증할 수 없습니다:
- 누구나 아는, 논란의 여지가 전혀 없는, 정답이 딱 하나로 분명한 사실만 사용하세요.
- 정답(정확한 사실)은 반드시 choices 안에 들어가 있어야 합니다.
- 애매하거나, 사실 여부가 확실하지 않거나, 사람마다 답이 다를 수 있는 내용이면 그 문제를 만들지 말고 건너뛰세요(추측 금지).
- 어렵고 헷갈리는 잡학보다, 안전하고 확실한 생활 상식을 우선하세요.`

function buildPrompt(level: Level): string {
  return `당신은 제주 어르신을 위한 "오늘의 뇌 운동" 문제를 만드는 따뜻한 선생님입니다. 재미있고 편안한 4지선다 문제를 만들어 순수 JSON으로만 출력하세요. 마크다운 없이.

${LEVEL_INSTRUCTIONS[level]}

※ 속담(language) 문제는 시스템이 따로 정확하게 만들어 넣습니다. 당신은 속담 문제를 절대 만들지 마세요.

만들 문제(아래 5개 도메인 각 1개, knowledge는 1~2개 → 총 5~6개):
1. memory(기억력): "다음 낱말을 기억하세요"용 낱말을 memoryPrep에 넣고, question은 간단한 회상 문제로. 예: memoryPrep "사과, 우산, 기차", question "방금 외운 낱말이 아닌 것은?", choices에 낱말 중 일부 + 새 낱말.
2. attention(주의·집중): "다음 중 종류가 다른 하나는?" 예: 사과·배·감·자동차 → 자동차.
3. category(언어-범주): "다음 중 과일이 아닌 것은?" 또는 "채소는 어느 것일까요?".
4. calculation(계산): 생활 속 돈 계산. 정답은 정확히 계산된 값이어야 합니다. + 4개 보기(금액).
5. knowledge(회상·상식): ${KNOWLEDGE_GUIDE}

공통 규칙:
- 정답은 딱 하나이며, 그 정답 텍스트는 반드시 choices 안에 그대로 들어 있어야 합니다.
- answerIndex는 choices 배열에서 정답의 위치(0부터 3)를 정확히 가리켜야 합니다.
- 함정 보기나 고의 혼동 금지(단, 비슷한 보기는 난이도에 맞게).
- 쉬운 우리말. 어려운 한자어·외래어 금지.
- explanation은 짧고 따뜻한 한두 문장 해설.
- 무섭거나 의학적인 내용 금지. 치매 예방·치료 같은 표현 절대 쓰지 마세요.
- choices는 정확히 4개.
- 정답이 확실하지 않은 문제는 아예 만들지 말고 건너뛰세요. 5개보다 적어도 괜찮습니다.
- 출력은 JSON 배열만(속담 제외).

출력 JSON 스키마:
[
  { "domain": "memory"|"attention"|"category"|"calculation"|"knowledge",
    "question": "문제", "choices": ["보기1","보기2","보기3","보기4"],
    "answerIndex": 0, "explanation": "따뜻한 해설", "memoryPrep": "기억력 문제에만(선택)" }
]
JSON 배열만 출력하세요.`
}

// ── Calculation verifier — never ship a wrong math answer ──────────────────────

/** Parse a Korean money/number choice like "3,000원" / "3000" → number. */
function parseAmount(s: string): number | null {
  const digits = s.replace(/[^0-9]/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

/**
 * Try to compute the expected numeric answer for a calculation question, ONLY
 * when the problem type is recognized with high confidence. Returns null when
 * the structure is ambiguous/unrecognized (→ caller trusts the AI's answer).
 *
 * Recognized (in priority order, most specific first):
 *   - change (거스름돈/잔돈): paid − sum(costs)
 *   - sum (모두/합/전부/합쳐): sum of all 원 amounts
 *   - product (단가 × 개수): unit price × quantity
 *   - explicit difference (차이): |a − b| of the two amounts
 */
function computeExpected(text: string): number | null {
  const wonNums = Array.from(text.matchAll(/(\d+)\s*원/g))
    .map((mm) => Number(mm[1]))
    .filter((n) => Number.isFinite(n))

  // ── change (거스름돈) — multi-step: paid − total cost ──
  const isChange = /(거스름돈|잔돈)/.test(text) && /(냈|내면|낸|내고|지불|드리면|드렸|주면)/.test(text)
  if (isChange) {
    // "paid" is the amount tied to 냈/지불/…; fall back to the largest amount.
    const paidMatch = text.match(/(\d+)\s*원[을를]?\s*(?:내|냈|낸|지불|드리|드렸|주)/)
    const paid = paidMatch && paidMatch[1] ? Number(paidMatch[1]) : Math.max(...wonNums, 0)
    if (wonNums.length >= 2 && Number.isFinite(paid)) {
      const costs = [...wonNums]
      const pi = costs.indexOf(paid)
      if (pi >= 0) costs.splice(pi, 1) // remove one occurrence of the paid amount
      const totalCost = costs.reduce((s, n) => s + n, 0)
      if (costs.length >= 1 && paid > totalCost) return paid - totalCost
    }
    return null // change problem we couldn't parse cleanly → don't guess
  }

  // ── sum (모두/합/전부/합쳐) ──
  if (/(모두|합쳐|합계|전부|다\s*해서|총)/.test(text) && wonNums.length >= 2) {
    return wonNums.reduce((s, n) => s + n, 0)
  }

  // ── product (단가 × 개수) ──
  const unitMatch = text.match(/(\d+)\s*원/)
  const qtyMap: Record<string, number> = { 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }
  let qty: number | null = null
  for (const [word, v] of Object.entries(qtyMap)) {
    if (text.includes(`${word} 개`) || text.includes(`${word}개`)) { qty = v; break }
  }
  if (qty === null) {
    const qtyNum = text.match(/(\d+)\s*개/)
    if (qtyNum && qtyNum[1]) qty = Number(qtyNum[1])
  }
  if (unitMatch && unitMatch[1] && qty !== null && wonNums.length === 1) {
    return Number(unitMatch[1]) * qty
  }

  // ── explicit difference (차이) ──
  if (/차이/.test(text) && wonNums.length === 2) {
    return Math.abs(wonNums[0]! - wonNums[1]!)
  }

  return null // unrecognized structure → let the caller trust the AI
}

/**
 * Validate a calculation question WITHOUT ever confidently shipping a wrong
 * answer. This is a VALIDATOR, not a corrector:
 *   - If we can't recognize the problem type → trust the AI's answer (keep).
 *   - If we confidently compute a value:
 *       · it matches exactly one choice AND that is the AI's chosen answer → keep.
 *       · it disagrees with the AI (matches a different choice, none, or many)
 *         → DROP the question (return null) rather than override.
 * Dropping over overriding is intentional: the earlier 거스름돈 bug came from an
 * over-confident override that moved the ✓ to the wrong (total-cost) choice.
 */
function verifyCalculation(q: BrainQuestion): BrainQuestion | null {
  if (q.domain !== 'calculation') return q

  const text = q.question.replace(/,/g, '')
  const amounts = q.choices.map(parseAmount)

  const expected = computeExpected(text)
  if (expected === null) return q // unrecognized → trust AI

  const matchIdxs = amounts
    .map((a, i) => (a === expected ? i : -1))
    .filter((i) => i >= 0)

  // Must match exactly one choice, and it must be the AI's chosen answer.
  if (matchIdxs.length === 1 && matchIdxs[0] === q.answerIndex) return q

  // Disagreement or ambiguity → drop rather than risk a wrong answer.
  return null
}

// ── Parse + sanitize the generated questions ───────────────────────────────────

const DOMAINS: Domain[] = ['memory', 'attention', 'language', 'category', 'calculation', 'knowledge']

/**
 * General guard applied to EVERY question (all domains). Returns a clean
 * question or null if malformed. Dropping is always preferred over coercing:
 * never ship a question whose answer is out of range, absent, or ambiguous.
 */
function wellFormed(q: BrainQuestion): BrainQuestion | null {
  if (!q.question || q.question.length === 0) return null
  if (!Array.isArray(q.choices) || q.choices.length !== 4) return null
  if (q.choices.some((c) => typeof c !== 'string' || c.trim().length === 0)) return null
  // Choices must be distinct (a repeated choice makes "the one answer" ambiguous).
  if (new Set(q.choices.map((c) => c.trim())).size !== 4) return null
  // answerIndex must point to a real choice.
  if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= q.choices.length) return null
  return q
}

function parseQuestions(raw: string): BrainQuestion[] | null {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return null
  try {
    const arr = JSON.parse(m[0]) as unknown[]
    const out: BrainQuestion[] = arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => {
        const choices = Array.isArray(x.choices)
          ? x.choices.filter((c): c is string => typeof c === 'string').map((c) => c.trim())
          : []
        const domain = (DOMAINS.includes(x.domain as Domain) ? x.domain : 'knowledge') as Domain
        const answerIndex = typeof x.answerIndex === 'number' ? x.answerIndex : -1
        const memoryPrep = typeof x.memoryPrep === 'string' && x.memoryPrep.trim() ? x.memoryPrep.trim() : undefined
        return {
          domain,
          question: typeof x.question === 'string' ? x.question.trim() : '',
          choices,
          answerIndex,
          explanation: typeof x.explanation === 'string' ? x.explanation.trim() : '',
          ...(memoryPrep ? { memoryPrep } : {}),
        }
      })
      // Proverbs are code-built from the whitelist — never trust an AI-invented one.
      .filter((q) => q.domain !== 'language')
      // General guard: drop anything malformed (bad answerIndex, empty/dupe choices).
      .map(wellFormed)
      .filter((q): q is BrainQuestion => q !== null)
      // Calc-specific verifier: drop calc questions we can't confidently confirm.
      .map(verifyCalculation)
      .filter((q): q is BrainQuestion => q !== null)

    return out // count floor is enforced by the caller (after adding the proverb)
  } catch {
    return null
  }
}

// ── Error helper ─────────────────────────────────────────────────────────────

function gracefulError() {
  return NextResponse.json(
    { error: true, message: '지금은 문제를 불러오지 못했어요. 잠시 후 다시 해주세요.' },
    { status: 200 }
  )
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url)
  const raw = url.searchParams.get('level') ?? 'normal'
  const level: Level = raw === 'easy' || raw === 'hard' ? raw : 'normal'

  // Cache key = YYYY-MM-DD-level (each difficulty caches separately)
  const day = `${kstDay(new Date())}-${level}`

  // 1) Fast path — cache lookup
  try {
    const { data, error } = await supabaseAdmin
      .from('jeju_resident_brain')
      .select('questions, generated_at')
      .eq('day', day)
      .maybeSingle()

    if (!error && data && Array.isArray(data.questions) && data.questions.length > 0) {
      return NextResponse.json({
        error: false,
        cached: true,
        day,
        level,
        questions: data.questions,
        generated_at: data.generated_at ?? null,
      })
    }
  } catch (e) {
    console.error('[brain] cache read failed:', e instanceof Error ? e.message : e)
  }

  // 2) Slow path — generate
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[brain] ANTHROPIC_API_KEY not configured')
    return gracefulError()
  }

  try {
    const system = buildPrompt(level)
    const raw2 = await callClaude(system, `난이도 "${level}" 뇌 운동 문제를 만들어 주세요(속담 제외).`, apiKey, 3200)
    if (raw2 === null) return gracefulError()

    const aiQuestions = parseQuestions(raw2)
    if (!aiQuestions) return gracefulError()

    // Always include one guaranteed-correct proverb (from the whitelist), placed first.
    const proverbQ = buildProverbQuestion(day)
    const questions = [proverbQ, ...aiQuestions]

    // ≥4-question floor: never ship a near-empty set.
    if (questions.length < 4) return gracefulError()

    const generatedAt = new Date().toISOString()

    // 3) Upsert on unique day key (last-write-wins)
    try {
      const { error: upsertErr } = await supabaseAdmin
        .from('jeju_resident_brain')
        .upsert({ day, questions, generated_at: generatedAt }, { onConflict: 'day' })
      if (upsertErr) console.error('[brain] upsert failed:', upsertErr.message)
    } catch (e) {
      console.error('[brain] upsert threw:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ error: false, cached: false, day, level, questions, generated_at: generatedAt })
  } catch (e) {
    console.error('[brain] generation failed:', e instanceof Error ? e.message : e)
    return gracefulError()
  }
}
