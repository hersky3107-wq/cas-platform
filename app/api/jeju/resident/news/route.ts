import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { askPerplexity } from '@/lib/jeju/resident-search'

/**
 * 오늘의 소식 — elderly-friendly daily news for resident mode.
 *
 * Twice-daily cache in `jeju_resident_news` keyed by a KST "slot":
 *   09:00–17:59  → YYYY-MM-DD-am  (today)
 *   18:00–23:59  → YYYY-MM-DD-pm  (today)
 *   00:00–08:59  → YYYY-MM-DD-pm  (YESTERDAY — last evening's news carries over)
 *
 * Fast path: if the slot exists, return it immediately (no AI calls).
 * Slow path: Perplexity (national) + Perplexity (Jeju) → Claude rewrite into
 * plain, elderly-friendly Korean JSON → upsert on the unique `slot`.
 *
 * All external calls are wrapped; on any failure we return a calm error object
 * rather than crashing. Concurrency: last-write-wins on the unique slot (no lock).
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

type NationalSection = '정치' | '경제' | '사회' | '국제' | '문화·예술' | '스포츠'

interface NationalItem {
  section: NationalSection
  title: string
  summary: string
}
interface JejuItem {
  title: string
  summary: string
}
interface NewsPayload {
  national: NationalItem[]
  jeju: JejuItem[]
  sources: string[]
}

// ── KST slot computation ───────────────────────────────────────────────────────

interface SlotInfo {
  slot: string
  /** 'am' | 'pm' — the half-day the content represents. */
  half: 'am' | 'pm'
  /** Plain-Korean freshness label, e.g. "오늘 오전 9시 기준". */
  freshLabel: string
}

function computeSlot(now: Date): SlotInfo {
  // Convert to KST regardless of server timezone.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const hour = kst.getUTCHours()

  const ymd = (d: Date) => {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  if (hour >= 9 && hour < 18) {
    return { slot: `${ymd(kst)}-am`, half: 'am', freshLabel: '오늘 오전 9시 기준' }
  }
  if (hour >= 18) {
    return { slot: `${ymd(kst)}-pm`, half: 'pm', freshLabel: '오늘 저녁 6시 기준' }
  }
  // 00:00–08:59 → yesterday's pm slot carries over.
  const yesterday = new Date(kst.getTime() - 24 * 60 * 60 * 1000)
  return { slot: `${ymd(yesterday)}-pm`, half: 'pm', freshLabel: '어제 저녁 6시 기준' }
}

// ── Claude call helper ──────────────────────────────────────────────────────

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
      console.error(`[news] anthropic http ${res.status}`)
      return null
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)
    return json.content?.find((b) => b.type === 'text')?.text ?? ''
  } catch (e) {
    console.error('[news] claude call failed:', e instanceof Error ? e.message : e)
    return null
  }
}

// ── Rewrite Perplexity prose → elderly-friendly JSON ─────────────────────────

const REWRITE_SYSTEM = `당신은 제주 어르신을 위한 라디오 뉴스 진행자입니다. 아래에 오늘의 전국 뉴스와 제주 뉴스 검색 결과가 주어집니다. 이것을 어르신이 듣기 쉬운 아주 쉬운 한국어로 다시 써서 순수 JSON으로만 출력하세요. 마크다운 없이.

【핵심 규칙 — 반드시 지키세요】

1. 지지율·여론조사 수치 절대 금지
   지지율, 여론조사 수치, 지지도, 정당 지지율(예: "지지율 58%", "민주당 42%", "격차 16%p")은 포함하지 마세요.
   정치 소식은 오직 구체적 사실(어떤 법·정책이 결정됐다, 어떤 행사·사건이 있었다, 어떤 발표가 있었다)만 전하세요.
   "A가 앞선다" "지지율 차이가 벌어졌다" 같은 경쟁·순위 표현도 금지합니다.

2. 정치 중립
   정치 소식은 "~가 결정됐다", "~가 논의되고 있다", "~가 발표됐다" 처럼 사실 서술로만 씁니다.
   어느 정당·정치인도 유리하거나 불리하게 보이는 표현을 쓰지 마세요.
   서로 다른 입장이 있으면 "A측은 ~라고 했고, B측은 ~라고 했습니다" 처럼 균형 있게 짧게.

3. 오늘 실제로 일어난 구체적 사건 우선
   전망·분석·칼럼·교훈 형식의 기사는 쓰지 마세요.
   "~에 대한 전망", "~가 중요한 이유", "~에서 배울 점" 같은 분석성 항목은 제외.
   어떤 결정이 내려졌는지, 어떤 사건이 발생했는지, 어떤 것이 바뀌었는지를 쓰세요.

4. 생활 영향 표현 권장
   가격 변동, 복지·수당 변경, 안전·건강 관련 소식은 "이것이 생활에 이렇게 영향을 줍니다"처럼 어르신 삶과 연결해 한 문장 추가해도 좋습니다.

5. 기타
   - 어려운 용어·전문용어·영어·한자어를 피하고, 실제 말하듯 쉬운 우리말로 풀어 쓰세요.
   - 각 요약은 2~3줄로 짧게. 핵심만.
   - 검색 결과에 실제로 있는 내용만 쓰세요. 없는 뉴스를 지어내지 마세요.
   - 전국 소식은 중앙지 메인급 큰 뉴스만. 사소한 지역 뉴스는 전국에 넣지 마세요.
   - 전국: 정치·경제·사회 각 2~3개, 국제 1~2개, 문화·예술·스포츠 각 1~2개 정도.
   - 제주 소식은 전국보다 더 두껍게 5~6개 이상.

출력 JSON 스키마(정확히 이 형태):
{
  "national": [ { "section": "정치"|"경제"|"사회"|"국제"|"문화·예술"|"스포츠", "title": "짧은 제목", "summary": "2~3줄 쉬운 요약" } ],
  "jeju": [ { "title": "짧은 제목", "summary": "2~3줄 쉬운 요약" } ]
}
JSON 객체만 출력하세요.`

async function rewriteToPlain(nationalText: string, jejuText: string, apiKey: string): Promise<{ national: NationalItem[]; jeju: JejuItem[] } | null> {
  const user = `[전국 뉴스 검색 결과]\n"""\n${nationalText.slice(0, 6000)}\n"""\n\n[제주 뉴스 검색 결과]\n"""\n${jejuText.slice(0, 6000)}\n"""`
  const raw = await callClaude(REWRITE_SYSTEM, user, apiKey, 3500)
  if (raw === null) return null
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[0]) as Record<string, unknown>
    const validSections: NationalSection[] = ['정치', '경제', '사회', '국제', '문화·예술', '스포츠']
    const national: NationalItem[] = Array.isArray(parsed.national)
      ? (parsed.national as unknown[])
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((x) => ({
            section: (validSections.includes(x.section as NationalSection) ? x.section : '사회') as NationalSection,
            title: typeof x.title === 'string' ? x.title.trim() : '',
            summary: typeof x.summary === 'string' ? x.summary.trim() : '',
          }))
          .filter((it) => it.title.length > 0 && it.summary.length > 0)
      : []
    const jeju: JejuItem[] = Array.isArray(parsed.jeju)
      ? (parsed.jeju as unknown[])
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((x) => ({
            title: typeof x.title === 'string' ? x.title.trim() : '',
            summary: typeof x.summary === 'string' ? x.summary.trim() : '',
          }))
          .filter((it) => it.title.length > 0 && it.summary.length > 0)
      : []
    if (national.length === 0 && jeju.length === 0) return null
    return { national, jeju }
  } catch {
    return null
  }
}

// ── Error helper ─────────────────────────────────────────────────────────────

function gracefulError() {
  return NextResponse.json(
    { error: true, message: '지금은 소식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
    { status: 200 }
  )
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET() {
  const { slot, freshLabel } = computeSlot(new Date())

  // 1) Fast path — cache lookup
  try {
    const { data, error } = await supabaseAdmin
      .from('jeju_resident_news')
      .select('national, jeju, sources, generated_at')
      .eq('slot', slot)
      .maybeSingle()

    if (!error && data) {
      return NextResponse.json({
        error: false,
        cached: true,
        slot,
        freshLabel,
        national: data.national ?? [],
        jeju: data.jeju ?? [],
        sources: data.sources ?? [],
        generated_at: data.generated_at ?? null,
      })
    }
  } catch (e) {
    console.error('[news] cache read failed:', e instanceof Error ? e.message : e)
    // fall through to generation
  }

  // 2) Slow path — generate
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[news] ANTHROPIC_API_KEY not configured')
    return gracefulError()
  }

  try {
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const dateLabel = `${today.getUTCFullYear()}년 ${today.getUTCMonth() + 1}월 ${today.getUTCDate()}일`

    // Perplexity 1 — national headline news (concrete events today, no polls/analysis)
    const nationalRes = await askPerplexity(
      `오늘(${dateLabel}) 대한민국에서 실제로 일어난 주요 사건·결정·발표를 분야별로 알려줘. 정치, 경제, 사회, 국제, 문화·예술, 스포츠 각 분야의 중앙 일간지 메인급 뉴스만. 조건: (1) 오늘 실제로 결정·발생·발표된 구체적 사실을 우선, (2) 여론조사 수치나 지지율·지지도 통계는 절대 포함하지 마, (3) 전망·분석·칼럼·"~에 대한 교훈" 형식은 제외, (4) 일반 시민 생활(가격·안전·복지·건강)에 영향 있는 소식 포함, (5) 사소하거나 지역 한정 뉴스는 제외. 각 뉴스의 이름과 핵심 내용을 구체적으로.`,
      {
        systemPrompt:
          '당신은 오늘 대한민국에서 실제로 일어난 주요 사건을 정리하는 검색 도우미입니다. 오늘 보도된 구체적 사실(결정·발생·발표) 위주로만 정리하세요. 여론조사 수치·지지율은 포함하지 마세요. 전망·분석 기사는 제외하세요. 정치는 중립적으로 사실만. 확인된 내용만.',
        maxTokens: 1200,
      }
    )

    // Perplexity 2 — Jeju regional news (thicker, life-relevant)
    const jejuRes = await askPerplexity(
      `오늘(${dateLabel}) 제주특별자치도에서 실제로 일어난 주요 지역 소식을 알려줘. 제주도민의 일상생활에 중요한 생활·행정·복지·수당·날씨·행사·교통·안전·건강 관련 소식을 6개 이상 구체적으로 정리해줘. 실제 결정·시행·발표된 사실 위주로, 전망이나 분석 기사는 제외.`,
      {
        systemPrompt:
          '당신은 오늘의 제주 지역 소식을 정리하는 검색 도우미입니다. 실제 오늘·최근 보도된 제주 관련 소식만, 사실 위주로 정리하세요. 주민 생활(복지·안전·교통·행사)에 영향 있는 소식을 우선하세요. 추측하지 말고 확인된 내용만.',
        maxTokens: 1200,
      }
    )

    const nationalText = nationalRes.text
    const jejuText = jejuRes.text
    if (!nationalText.trim() && !jejuText.trim()) {
      return gracefulError()
    }

    // Claude rewrite → plain elderly-friendly JSON
    const rewritten = await rewriteToPlain(nationalText, jejuText, apiKey)
    if (!rewritten) {
      return gracefulError()
    }

    const sources = Array.from(new Set([...nationalRes.citations, ...jejuRes.citations])).slice(0, 12)
    const generatedAt = new Date().toISOString()

    const payload: NewsPayload = { national: rewritten.national, jeju: rewritten.jeju, sources }

    // 3) Upsert on unique slot (last-write-wins)
    try {
      const { error: upsertErr } = await supabaseAdmin
        .from('jeju_resident_news')
        .upsert(
          {
            slot,
            national: payload.national,
            jeju: payload.jeju,
            sources: payload.sources,
            generated_at: generatedAt,
          },
          { onConflict: 'slot' }
        )
      if (upsertErr) console.error('[news] upsert failed:', upsertErr.message)
    } catch (e) {
      console.error('[news] upsert threw:', e instanceof Error ? e.message : e)
      // still return the generated content even if caching failed
    }

    return NextResponse.json({
      error: false,
      cached: false,
      slot,
      freshLabel,
      national: payload.national,
      jeju: payload.jeju,
      sources: payload.sources,
      generated_at: generatedAt,
    })
  } catch (e) {
    console.error('[news] generation failed:', e instanceof Error ? e.message : e)
    return gracefulError()
  }
}
