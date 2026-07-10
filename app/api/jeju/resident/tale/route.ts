import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { askPerplexity } from '@/lib/jeju/resident-search'

/**
 * 이야기(TALE) — AI-generated, listen-first daily content for Jeju resident seniors.
 *
 * INDEPENDENT of the care app: caches in `jeju_resident_tale` (NOT care_tale).
 * No imports from app/care/** or lib/care/**.
 *
 * Five kinds, each generated ONCE per day by Claude:
 *   life      인생 이야기        short emotional life stories of that generation
 *   health    오늘의 건강 이야기  Perplexity×3 deep research → TV-depth segments
 *   reminisce 그 시절 회상        reminiscence-therapy prompts
 *   wisdom    오늘의 좋은 말      short daily 덕담·지혜·명언 (religiously neutral)
 *   jeju      제주 이야기         Perplexity-grounded 설화·역사·삶 (3 layers)
 *
 * Cache key `day` = 'YYYY-MM-DD-{kind}' (KST). Fast path returns the cached row
 * with no AI calls; slow path generates → upserts on unique `day` → returns.
 *
 * Every external call is wrapped; on any failure we return a calm error object
 * (HTTP 200) instead of crashing. Concurrency: last-write-wins on unique `day`.
 */

export const runtime = 'nodejs'
export const maxDuration = 90

const MODEL = 'claude-sonnet-4-6'

// ── Kinds ────────────────────────────────────────────────────────────────────

const KINDS = ['life', 'health', 'reminisce', 'wisdom', 'jeju'] as const
type Kind = (typeof KINDS)[number]

function isKind(v: string): v is Kind {
  return (KINDS as readonly string[]).includes(v)
}

/** Item shapes vary per kind; all fields optional so one type covers the union. */
interface TaleItem {
  title?: string
  body?: string
  /** reminisce only — gentle questions to invite memory */
  questions?: string[]
  /** wisdom only — short line + optional attribution */
  text?: string
  source?: string
  /** health only — a light "의사·약사와 상담" note when relevant (may be absent) */
  note?: string
}

// ── KST day key ──────────────────────────────────────────────────────────────

function kstDay(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function seasonLabel(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const m = kst.getUTCMonth() + 1
  if (m >= 3 && m <= 5) return '봄'
  if (m >= 6 && m <= 8) return '여름'
  if (m >= 9 && m <= 11) return '가을'
  return '겨울'
}

// ── Claude call helper (same shape as /api/care/news) ────────────────────────

async function callClaude(system: string, user: string, apiKey: string, maxTokens: number): Promise<string | null> {
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
        // A touch of warmth/variety in the prose; still well-controlled.
        temperature: 0.8,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) {
      console.error(`[tale] anthropic http ${res.status}`)
      return null
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)
    return json.content?.find((b) => b.type === 'text')?.text ?? ''
  } catch (e) {
    console.error('[tale] claude call failed:', e instanceof Error ? e.message : e)
    return null
  }
}

function extractJsonArray(raw: string): unknown[] | null {
  // Prefer an { "items": [...] } object; fall back to a bare array.
  const objMatch = raw.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>
      if (Array.isArray(parsed.items)) return parsed.items
    } catch {
      /* fall through */
    }
  }
  const arrMatch = raw.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]) as unknown
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* fall through */
    }
  }
  return null
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// ── Per-kind prompts + parsers ───────────────────────────────────────────────

/** 인생 이야기 — the heart. Genuinely moving, well-crafted, VARIED tone. */
function lifeSystem(season: string): string {
  return `당신은 한국 어르신의 마음을 깊이 이해하는 따뜻한 이야기 작가입니다. 지금 세대(70~90대) 한국 어르신이 "이거 꼭 내 얘기 같다" 하고 공감할 만한 짧은 인생 이야기를 씁니다.

【소재】 시집살이, 가난했던 시절, 자식 키운 이야기, 부모·형제, 첫사랑·부부의 정, 고향과 떠나온 길, 세월의 변화, 삶의 애환 — 그 시절 우리네 인생.

【톤 — 다양하게】 매번 같은 색이면 안 됩니다. 어떤 이야기는 한(恨)과 애틋함, 어떤 것은 밝고 따뜻함, 어떤 것은 슬며시 웃음이 나는 정겨움, 어떤 것은 뭉클함. 깊이가 있어도 좋습니다. 진짜 문학적인, 잘 쓴 한국어 산문으로 쓰세요. 뻔한 상투적 표현("고생 끝에 낙이 온다" 같은 교훈조)이나 인공지능 티 나는 밋밋한 글은 절대 안 됩니다.

【단 하나의 금지선】 죽음·절망·자기파괴로 끝맺지 마세요. 한이 서린 이야기라도 마지막은 담담한 수용, 따뜻함, 혹은 조용한 품위로 잦아들게 하세요. 읽고 나서 마음이 무너지는 게 아니라, 촉촉해지거나 잔잔해지도록.

【형식】
- 이야기 2~3편. 각 편마다 제목을 붙이세요 (짧고 서정적으로).
- 각 편은 A4 반 장~한 장 분량 (한국어로 약 500~900자). 너무 짧지 않게, 장면과 감정이 살아나게.
- 쉬운 말로. 어려운 한자어·외래어 피하고, 소리 내어 읽어주기 좋은 자연스러운 문장.
- 존댓말 서술 또는 담백한 3인칭 — 어느 쪽이든 어르신이 듣기 편하게.

순수 JSON만 출력하세요(마크다운·설명 금지):
{"items":[{"title":"이야기 제목","body":"이야기 본문 (문단은 \\n 으로 구분)"}]}`
}

/** Perplexity research slots — one deep query per health item. */
const HEALTH_RESEARCH_SLOTS = [
  {
    slot: 'food',
    label: '놀라운 음식·영양',
    query: (season: string) =>
      `한국어로 답하세요. 70~90대 어르신 건강 — "어, 그건 몰랐네" 할 만한 음식·영양소·식품 1가지를 깊이 조사해 주세요. ` +
      `뻔한 "물·걷기·수면·에어컨" 금지. 특정 상표·제품명 금지. 치료·완치 주장 금지.\n` +
      `반드시 포함:\n` +
      `1) WHAT — 구체적 음식/성분/부위\n` +
      `2) WHY — 생물학적·생리학적 기전을 쉬운 말로\n` +
      `3) HOW — 구체적 양·횟수·시간·방법\n` +
      `4) 숫자·연구 — "~에 따르면" "연구에서" 근거 1~2문장\n` +
      `${season}철과 연관 있으면 언급. 400~600자 분량의 팩트만.`,
  },
  {
    slot: 'myth',
    label: '오해 바로잡기',
    query: () =>
      `한국어로 답하세요. 한국 어르신 사이 흔한 건강 오해 1가지와 진실을 깊이 조사해 주세요. ` +
      `뻔한 조언·상표·치료 주장 금지.\n` +
      `반드시 포함: WHAT(잘못된 믿음) / WHY(왜 틀렸는지 기전) / WHAT 대신(올바른 이해·대안) / 근거.\n` +
      `400~600자 분량의 팩트만.`,
  },
  {
    slot: 'technique',
    label: '실용 기법',
    query: () =>
      `한국어로 답하세요. 70~90대가 바로 해볼 수 있는 구체적 건강 기법(동작·습관·타이밍) 1가지를 깊이 조사해 주세요. ` +
      `"그냥 걷세요" 수준 금지. 상표·치료 주장 금지.\n` +
      `반드시 포함: WHAT(정확한 동작) / WHY(기전) / HOW(횟수·시간·주의) / 근거·수치.\n` +
      `400~600자 분량의 팩트만.`,
  },
] as const

const HEALTH_PPLX_SYSTEM =
  '당신은 종편 TV 건강 프로그램 리서처입니다. ' +
  '신뢰할 수 있는 근거를 바탕으로 구체적 수치·기전·방법을 깊이 있게 정리하세요. ' +
  '과장·상품명·치료·완치 주장 없이. 한국 어르신이 이해할 쉬운 말로.'

/** Three parallel Perplexity deep-dives — one per health segment. */
async function fetchHealthGrounding(season: string): Promise<string> {
  const blocks: string[] = []
  try {
    const results = await Promise.all(
      HEALTH_RESEARCH_SLOTS.map(async ({ slot, label, query }) => {
        try {
          const pplx = await askPerplexity(query(season), {
            systemPrompt: HEALTH_PPLX_SYSTEM,
            maxTokens: 1200,
            timeoutMs: 25_000,
          })
          const cites =
            pplx.citations.length > 0
              ? `\n[출처 URL] ${pplx.citations.slice(0, 3).join(' | ')}`
              : ''
          return { slot, label, text: (pplx.text + cites).trim() }
        } catch (e) {
          console.error(`[tale] health pplx ${slot} failed:`, e instanceof Error ? e.message : e)
          return { slot, label, text: '' }
        }
      })
    )
    for (const r of results) {
      if (r.text) blocks.push(`=== ${r.label} (${r.slot}) ===\n${r.text}`)
    }
  } catch (e) {
    console.error('[tale] health grounding failed:', e instanceof Error ? e.message : e)
  }
  return blocks.join('\n\n')
}

/** 오늘의 건강 이야기 — TV-depth segments grounded in Perplexity research. */
function healthSystem(season: string, grounding: string): string {
  const groundingBlock = grounding.trim()
    ? `\n\n【리서치 자료 — 아래 3블록 각 1개 팁으로 변환. 없는 내용 지어내지 마세요】\n"""\n${grounding.slice(0, 9000)}\n"""`
    : ''
  return `당신은 종편 TV 건강 프로그램 진행자입니다. 어르신이 "어, 그건 몰랐네" 하고 끝까지 듣는, 깊이 있는 건강 이야기 3편을 씁니다. 교과서·뻔한 조언("물 많이", "걷기", "수면")은 절대 금지.

【깊이 목표 — 종편 건강 프로그램 한 코너 수준】
각 편은 WHAT(무엇) + WHY(몸 안에서 왜 그런지, 기전·이유 — 핵심) + HOW(얼마나·언제·어떻게)를 모두 담습니다.
· 놀람 또는 오해 바로잡기 포함 가능
· 리서치에 있으면 "~에 따르면", "○○ 연구에서" 등 자연스럽게 1문장 (학술 톤 금지, 따뜻한 구어체)

【3편 — 리서치 블록과 1:1】
1) food → 놀라운 음식·영양 (생물학적 이유)
2) myth → 흔한 오해 바로잡기 (왜 틀렸는지)
3) technique → 실용 기법 (왜 효과 있는지 + 구체적 방법)

계절(${season})은 억지로 끼우지 마세요.

【절대 금지】 상표·치료·완치 주장·진료 미루기. note는 약·심각한 질환일 때만(대부분 빈 문자열).

【형식】
- 정확히 3개. title(12~22자) + body(300~500자, WHY가 body 절반 이상) + note(선택).
- body는 소리 내어 읽기 좋은 구어체. 문단은 \\n 가능.${groundingBlock}

순수 JSON만 출력하세요(마크다운·설명 금지):
{"items":[{"title":"짧은 제목","body":"깊이 있는 설명 (WHAT+WHY+HOW+근거)","note":""}]}`
}

/** 그 시절 회상 — 1950s–70s Korean life with vivid period texture. */
function reminisceSystem(season: string): string {
  return `당신은 1950~1970년대를 직접 살아온 한국 어르신의 기억을 깨우는 회상 도우미입니다. 현대인이 상상하는 "예쁜 옛날"이 아니라, 그 시절을 진짜로 겪은 분이 "아, 그거다" 하고 코끝이 찡해지는 구체적 장면을 그립니다.

【시대감 — 반드시 살아 있는 디테일】 아래는 예시 방향(그대로만 반복하지 말고, 매번 다른 구체적 장면으로):
연탄불·연탄재·보릿고개·공동수도·물지게·새마을운동·새마을 노래·흑백TV 동네 한 대·라디오 연속극·국민학교 도시락·난로 위에 도시락 데우기·재봉틀·흑백 사진관·통금·극장 동시상영·눈깔사탕·라면 처음·고무신·등잔·호롱불·월남 파병·독일 광부·간호사·못 먹고 자란 시절·이웃과 나눈 한 그릇·${season}철 그 시절 풍경 등.

【톤】 가난했지만 정(情) 있던, 고생스러웠지만 그리운 — 코끝이 찡한 진짜 삶. 위생적으로 미화하거나 "요즘은 좋지요" 식 현대 비교는 금지. 그 시절 그대로, 따뜻하지만 솔직하게. 지나치게 슬프거나 트라우마만 파고들지는 마세요 — 그리움과 정이 중심.

【형식】
- 회상 주제 3개. 서로 다른 시대·장면(학교/집/동네/일/명절 등)으로.
  - title: 그 장면을 찌르는 짧은 제목 (예: "연탄불 갈던 새벽", "동네 흑백TV 앞")
  - body: 4~6문장. 구체적 감각(냄새·소리·손 feeling·그 시절 물건 이름)이 살아나게. 존댓말.
  - questions: 어르신 기억을 끄집어내는 다정한 질문 2~3개 ("그때 ○○은 어떠셨어요?")

순수 JSON만 출력하세요(마크다운·설명 금지):
{"items":[{"title":"회상 주제","body":"그 시절을 그려주는 따뜻한 이야기","questions":["다정한 질문1","다정한 질문2"]}]}`
}

/** 오늘의 좋은 말 — attributed sage/scripture wisdom + warm 덕담, balanced sources. */
function wisdomSystem(season: string): string {
  return `당신은 어르신께 하루의 힘이 되는 좋은 말을 전하는 따뜻한 벗입니다. 짧은 덕담·삶의 지혜·명언·경전의 좋은 말씀을 골라, 듣고 나면 마음이 편안해지게 합니다.

【출처 — 반드시 다양하고, 존중하며, 균형 있게】
- 동양 성현: 공자, 맹자, 노자, 장자 등 — 《논어》《맹자》 등에서 널리 알려진 구절
- 서양 철학·문인: 소크라테스, 세네카, 톨스토이, 헬렌 켈러 등
- 종교 성인·경전(따뜻하고 보편적인 구절만, 존중하며): 석가모니(부처), 예수, 성경·불경에서 널리 전해지는 좋은 말씀
- 우리 속담, 삶의 지혜

한 종교·한 출처만 몰리지 마세요. 부처·예수·공자·서양·속담·덕담이 골고루 섞이게 (예: 5개 중 각각 다른 출처).

【형식 — 5~6개】
- text: 짧고 따뜻한 한~두 문장. 쉬운 한국어.
- source: 반드시 짧은 출처 표기 (예: "공자", "석가모니", "예수", "성경", "불경", "속담", "톨스토이"). 
  · 출처 있는 말: 4~5개 (대부분)
  · 출처 없는 짧은 덕담: 1개 정도만 ("오늘도 수고 많으셨어요" 같은 — source는 빈 문자열)

어르신이 듣고 바로 마음에 와닿게. 어렵거나 설교조·종교 논쟁조 금지.

순수 JSON만 출력하세요(마크다운·설명 금지):
{"items":[{"text":"오늘의 좋은 말","source":"공자 / 석가모니 / 예수 / 속담 등"}]}`
}

// ── 제주 이야기 — Perplexity-grounded folklore / history / life ───────────────
// Three layers mixed across 2–3 daily items. ACCURACY IS CRITICAL: Claude must
// only write what Perplexity confirms. Never invent deity names, place names,
// or historical claims. Avoid 4·3 as a direct topic.

/** Rotate topic picks by KST day so the same three layers don't always repeat. */
function jejuTopicPicks(dayKey: string): { layer: 'myth' | 'history' | 'life'; label: string; query: string }[] {
  // Stable hash from YYYY-MM-DD
  let h = 0
  for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) >>> 0

  const MYTH = [
    { label: '설문대할망', query: '제주 설문대할망 설화 내용 창조 여신 한라산 전설 정확한 내용' },
    { label: '자청비·세경본풀이', query: '제주 자청비 세경본풀이 설화 내용 농경신 정확한 줄거리' },
    { label: '영등할망', query: '제주 영등할망 영등굿 바람의 신 설화 풍속 정확한 내용' },
    { label: '삼성혈', query: '제주 삼성혈 고을나 양을나 부을나 탐라 개국신화 정확한 내용' },
    { label: '오돌또기', query: '제주 오돌또기 설화 전설 내용 정확한 줄거리' },
  ]
  const HISTORY = [
    { label: '탐라국', query: '탐라국 역사 고대 제주 독립 왕국 개요 주요 사실' },
    { label: '삼별초·항파두리', query: '제주 삼별초 항파두리 항쟁 역사 개요 주요 사실' },
    { label: '유배의 섬', query: '조선시대 제주 유배 역사 유배인 섬살이 개요 주요 사실' },
    { label: '근대 섬살이', query: '근대 제주 섬살이 생활사 개요 주요 사실 (4·3 제외)' },
  ]
  const LIFE = [
    { label: '해녀·물질', query: '제주 해녀 물질 문화 숨비소리 테왁 정확한 풍속 설명' },
    { label: '감귤·밭담', query: '제주 감귤밭 밭담 돌담 문화 풍속 정확한 설명' },
    { label: '초가·조랑말', query: '제주 초가집 조랑말 전통 생활 문화 정확한 설명' },
    { label: '제주 먹거리', query: '제주 전통 먹거리 몸국 고기국수 자리물회 빙떡 유래와 특징' },
    { label: '바람·바다', query: '제주 바람 바다와 함께한 섬 생활 정서 풍속 정확한 설명' },
  ]

  return [
    { layer: 'myth', ...MYTH[h % MYTH.length]! },
    { layer: 'history', ...HISTORY[(h >> 3) % HISTORY.length]! },
    { layer: 'life', ...LIFE[(h >> 6) % LIFE.length]! },
  ]
}

const JEJU_PPLX_SYSTEM =
  '당신은 제주 설화·역사·풍속을 정확히 정리하는 리서처입니다. ' +
  '확인된 사실만 한국어로 정리하세요. 추측·창작·과장 금지. ' +
  '신·인물·지명·연대는 출처가 분명할 때만. 4·3은 다루지 마세요.'

/** Three parallel Perplexity deep-dives — one per Jeju layer for today. */
async function fetchJejuGrounding(dayKey: string): Promise<string> {
  const picks = jejuTopicPicks(dayKey)
  const blocks: string[] = []
  try {
    const results = await Promise.all(
      picks.map(async ({ layer, label, query }) => {
        try {
          const pplx = await askPerplexity(
            `한국어로 답하세요. "${label}"에 대해 제주 어르신께 들려줄 따뜻한 이야기의 근거가 될 ` +
              `확인된 사실만 정리해 주세요.\n검색 초점: ${query}\n` +
              `반드시 포함: 핵심 줄거리/사실 3~6개, 고유명사(신·인물·지명)는 확인된 것만, ` +
              `불확실하면 "확인되지 않음"이라고 명시. 창작 금지. 400~700자.`,
            {
              systemPrompt: JEJU_PPLX_SYSTEM,
              maxTokens: 1400,
              timeoutMs: 25_000,
            }
          )
          const cites =
            pplx.citations.length > 0
              ? `\n[출처 URL] ${pplx.citations.slice(0, 3).join(' | ')}`
              : ''
          return { layer, label, text: (pplx.text + cites).trim() }
        } catch (e) {
          console.error(`[tale] jeju pplx ${layer} failed:`, e instanceof Error ? e.message : e)
          return { layer, label, text: '' }
        }
      })
    )
    for (const r of results) {
      if (r.text) {
        const layerKo =
          r.layer === 'myth' ? '설화·신화' : r.layer === 'history' ? '역사' : '삶·정서'
        blocks.push(`=== ${layerKo} · ${r.label} ===\n${r.text}`)
      }
    }
  } catch (e) {
    console.error('[tale] jeju grounding failed:', e instanceof Error ? e.message : e)
  }
  return blocks.join('\n\n')
}

/** 제주 이야기 — Perplexity-grounded FACTS, written as STORIES (not explainers). */
function jejuSystem(season: string, grounding: string): string {
  const groundingBlock = grounding.trim()
    ? `\n\n【리서치 자료 — 사실·이름·줄거리의 유일한 근거. 없는 사실·이름·지명은 절대 지어내지 마세요】\n"""\n${grounding.slice(0, 10000)}\n"""`
    : '\n\n【리서치 자료 없음 — 잘 알려진 제주 주제만, 불확실한 고유명사·연대는 쓰지 마세요】'

  return `당신은 제주 어르신의 마음을 깊이 아는 이야기 작가입니다. 제주 토박이가 듣고 "맞아, 그랬주" 하고 끄덕일 만한 「제주 이야기」를 씁니다 — 정보가 아니라 장면이 있는 이야기.

【절대 금지 — 백과사전 톤】
다음처럼 쓰지 마세요: "~입니다", "~전해집니다", "~라고 합니다", "~문화입니다", "~역사입니다", 사실 나열, 정의문, 설명문.
목표 반응은 "맞아, 그랬주"(공감·따뜻함)이지 "그렇구나"(정보 습득)가 아닙니다.

【이야기 쓰는 법 — 인생 이야기와 같은 뼈대】
각 편마다 반드시:
1) 한 사람(또는 한 존재) — 구체적 인물·신·조상. 익명의 "사람들"이 아니라 그 사람.
2) 한 장면·한 순간 — 그날, 그 새벽, 그 저녁. 시간이 흐르는 한 컷.
3) 감각 — 냄새·소리·손의 감촉·바람·물·빛. 제주답게: 숨비소리, 테왁의 무게, 감귤 냄새, 돌담 사이 바람, 파도, 밭의 흙…
4) 조용히 남는 끝 — 교훈조·설교조 금지. 담담한 수용, 따뜻함, 혹은 조용한 품위.

【세 층 — 리서치 블록이 있으면 각 블록을 1편으로 (설화 1 · 역사 1 · 삶 1)】

(a) 설화·신화 — 할머니가 불 옆에서 들려주듯. 진짜 줄거리(리서치 확인분)는 지키되, 드라마와 온기로 살아나게. 신이 움직이고, 말이 오가고, 섬이 숨 쉬는 장면으로. 위키 요약 금지.

(b) 역사 — 연표·사실 나열 금지. 한 사람의 순간이나 선명한 이미지 하나에 닻을 내리세요 (예: 항파두리의 어느 밤, 유배인이 처음 발을 디딘 바닷가, 탐라의 어느 항구). 리서치에 있는 사실만 배경으로 스며들게. 가볍게, 이야기처럼.

(c) 삶·정서(가장 중요) — "해녀는 이렇게 살았습니다" 금지. "그날 그 사람은…"으로. 예: 첫 물질의 소녀, 할머니의 손, 감귤 따는 저녁, 몸국 끓는 아침. 제주 감각이 피부에 닿게.

【톤 — 다양하게】
어떤 편은 뭉클하고, 어떤 편은 정겹고, 어떤 편은 경이롭고, 어떤 편은 살짝 극적으로. 매번 같은 색이면 안 됩니다. 진짜 잘 쓴 한국어 산문. 상투적 교훈("고생 끝에 낙이 온다")·인공지능 티 나는 밋밋한 글 금지.

【정확성 — 사실과 장면의 경계】
- 신 이름·지명·사건·줄거리·풍속 사실은 리서치에 확인된 것만. 지어내지 마세요.
- 장면의 감각·하루의 순간·한 사람의 손길 같은 "이야기 살"은 리서치 사실을 해치지 않는 범위에서 생생하게 그려도 됩니다 (예: 확인된 해녀 풍속에 숨비소리·테왁 무게를 입히기).
- 표준 한국어. 억지 제주 사투리 금지 (확실한 단어 하나 정도는 가능).
- 4·3은 직접 다루지 마세요.
- 죽음·절망·자기파괴로 끝내지 마세요.

【형식】
- 이야기 2~3편. title(짧고 서정적) + body(한국어 약 500~900자 — 장면이 살아나도록, 너무 짧지 않게. 문단은 \\n).
- 소리 내어 읽기 좋은 존댓말 서술 또는 담백한 3인칭.
- 계절(${season})은 억지로 끼우지 마세요.${groundingBlock}

순수 JSON만 출력하세요(마크다운·설명 금지):
{"items":[{"title":"이야기 제목","body":"이야기 본문 (문단은 \\n 으로 구분)"}]}`
}

function parseItems(kind: Kind, raw: unknown[]): TaleItem[] {
  const objs = raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  if (kind === 'life' || kind === 'jeju') {
    return objs
      .map((o) => ({ title: str(o.title), body: str(o.body) }))
      .filter((it) => it.title.length > 0 && it.body.length > 0)
  }
  if (kind === 'health') {
    return objs
      .map((o) => ({ title: str(o.title), body: str(o.body), note: str(o.note) || undefined }))
      .filter((it) => it.title.length > 0 && it.body.length > 0)
  }
  if (kind === 'reminisce') {
    return objs
      .map((o) => ({
        title: str(o.title),
        body: str(o.body),
        questions: Array.isArray(o.questions)
          ? (o.questions as unknown[]).map(str).filter((q) => q.length > 0)
          : [],
      }))
      .filter((it) => it.title.length > 0 && it.body.length > 0)
  }
  // wisdom
  return objs
    .map((o) => ({ text: str(o.text), source: str(o.source) || undefined }))
    .filter((it) => (it.text ?? '').length > 0)
}

function kindConfig(kind: Kind, season: string): { system: string; maxTokens: number } {
  switch (kind) {
    case 'life':
      return { system: lifeSystem(season), maxTokens: 4200 }
    case 'reminisce':
      return { system: reminisceSystem(season), maxTokens: 2800 }
    case 'wisdom':
      return { system: wisdomSystem(season), maxTokens: 1600 }
    case 'health':
      // health `system` is built later (needs Perplexity grounding); placeholder here.
      return { system: '', maxTokens: 3600 }
    case 'jeju':
      // jeju `system` is built later (needs Perplexity grounding); placeholder here.
      return { system: '', maxTokens: 4200 }
  }
}

const KIND_USER_NUDGE: Record<Kind, string> = {
  life: '오늘의 인생 이야기 2~3편을 새로 써 주세요. 서로 톤이 다르게(하나는 애틋하게, 하나는 따뜻하거나 정겹게). JSON만.',
  health:
    '오늘의 건강 이야기 3편. 리서치 블록(food/myth/technique) 각 1개씩. WHAT+WHY(기전)+HOW+근거, body 300~500자, WHY가 절반 이상. JSON만.',
  reminisce: '1950~70년대 한국 어르신이 "그거다" 할 회상 3가지. 연탄·보릿고개·흑백TV·새마을·물지게 등 진짜 시대 디테일로, 코끝 찡한 그리움. JSON만.',
  wisdom: '오늘의 좋은 말 5~6개. 공자·석가모니·예수·서양·속담·덕담 골고루, source 반드시 표기(대부분). JSON만.',
  jeju:
    '오늘의 제주 이야기 2~3편. 백과사전·설명문 금지. 각 편 = 한 사람 + 한 장면 + 감각 + 잔잔한 끝. ' +
    '리서치 사실만 근거로, "맞아 그랬주"가 나오게. 4·3·절망 엔딩 금지. JSON만.',
}

// ── Error helper ─────────────────────────────────────────────────────────────

function gracefulError() {
  return NextResponse.json(
    { error: true, message: '지금은 이야기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
    { status: 200 }
  )
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url)
  const kindParam = (url.searchParams.get('kind') ?? '').trim()
  if (!isKind(kindParam)) {
    return NextResponse.json(
      { error: true, message: '알 수 없는 이야기 종류예요.' },
      { status: 200 }
    )
  }
  const kind: Kind = kindParam
  const now = new Date()
  const day = `${kstDay(now)}-${kind}`

  // 1) Fast path — cache lookup on unique `day`
  try {
    const { data, error } = await supabaseAdmin
      .from('jeju_resident_tale')
      .select('items, generated_at')
      .eq('day', day)
      .maybeSingle()

    if (!error && data && Array.isArray(data.items) && data.items.length > 0) {
      return NextResponse.json({
        error: false,
        cached: true,
        kind,
        day,
        items: data.items,
        generated_at: data.generated_at ?? null,
      })
    }
  } catch (e) {
    console.error('[tale] cache read failed:', e instanceof Error ? e.message : e)
    // fall through to generation
  }

  // 2) Slow path — generate with Claude
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[tale] ANTHROPIC_API_KEY not configured')
    return gracefulError()
  }

  try {
    const season = seasonLabel(now)

    // health / jeju: Perplexity grounding → Claude rewrite.
    let system: string
    let maxTokens: number
    if (kind === 'health') {
      const grounding = await fetchHealthGrounding(season)
      system = healthSystem(season, grounding)
      maxTokens = kindConfig('health', season).maxTokens
    } else if (kind === 'jeju') {
      const grounding = await fetchJejuGrounding(kstDay(now))
      system = jejuSystem(season, grounding)
      maxTokens = kindConfig('jeju', season).maxTokens
    } else {
      const cfg = kindConfig(kind, season)
      system = cfg.system
      maxTokens = cfg.maxTokens
    }

    const raw = await callClaude(system, KIND_USER_NUDGE[kind], apiKey, maxTokens)
    if (raw === null) return gracefulError()

    const arr = extractJsonArray(raw)
    if (!arr) return gracefulError()

    const items = parseItems(kind, arr)
    if (items.length === 0) return gracefulError()

    const generatedAt = new Date().toISOString()

    // 3) Upsert on unique `day` (last-write-wins)
    try {
      const { error: upErr } = await supabaseAdmin
        .from('jeju_resident_tale')
        .upsert({ day, kind, items, generated_at: generatedAt }, { onConflict: 'day' })
      if (upErr) console.error('[tale] upsert failed:', upErr.message)
    } catch (e) {
      console.error('[tale] upsert threw:', e instanceof Error ? e.message : e)
      // still return generated content even if caching failed
    }

    return NextResponse.json({
      error: false,
      cached: false,
      kind,
      day,
      items,
      generated_at: generatedAt,
    })
  } catch (e) {
    console.error('[tale] generation failed:', e instanceof Error ? e.message : e)
    return gracefulError()
  }
}
