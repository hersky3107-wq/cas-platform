import { NextResponse } from 'next/server'

/**
 * Stateless multimodal "photo helper" for the national senior-care mode.
 *
 * COPIED verbatim from app/api/jeju/resident/photo-analyze (no lib or DB deps).
 *
 * PRIVACY / SAFETY (non-negotiable):
 *  - The image/text and the result are processed ONCE and NEVER persisted.
 *    No DB write, no file save, no logging of image bytes or extracted content.
 *  - The model is instructed to omit all personal identifiers from output.
 *
 * POST body:
 *   Image path (all modes):  { image: string (base64 or data URL), mediaType?: string, mode: PhotoMode }
 *   Text path (phishing only): { text: string, mode: 'phishing' }
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

type PhotoMode = 'document' | 'phishing' | 'kiosk' | 'medicine'
const MODES: PhotoMode[] = ['document', 'phishing', 'kiosk', 'medicine']

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// ── Shared privacy/safety preamble injected into every mode prompt ─────────────

const PRIVACY_RULES = `
[개인정보·안전 규칙 — 반드시 지킬 것]
- 출력에 사람 이름, 주민등록번호, 상세 주소, 전화번호, 병명·진단명·질병코드 등 개인 식별 정보를 절대 포함하지 마세요. 보이면 무시하고 생략하세요.
- 제공된 내용에만 근거하세요. 보이지/적혀있지 않는 것은 추측하지 마세요.
- 내용이 흐릿하거나 글자를 읽을 수 없으면 정확히 이 JSON만 출력하세요:
  {"unreadable": true, "message": "사진이 잘 안 보여요. 밝은 곳에서 다시 찍어주세요."}
- 마크다운, 코드블록, 설명 없이 순수 JSON만 출력하세요. 모든 값은 한국어로, 어르신이 이해하기 쉬운 말로 작성하세요.`

// ── Mode-specific system prompts ────────────────────────────────────────────────

const MODE_PROMPTS: Record<PhotoMode, string> = {
  document: `당신은 어르신을 돕는 문서·고지서 도우미입니다. 사진 속 고지서/안내문/문서를 읽고 아래 JSON만 출력하세요.
${PRIVACY_RULES}

출력 JSON 스키마:
{
  "mainAction": "지금 해야 할 일 한 문장 (가장 크게 보여줄 핵심. 예: '7월 15일까지 38,420원을 내세요')",
  "amount": "금액 (명확히 적혀있을 때만; 불명확하면 null)",
  "dueDate": "납부/처리 기한 (명확할 때만; 불명확하면 null)",
  "where": "어디에/어떻게 처리하는지 (예: '은행 또는 계좌이체'; 불명확하면 null)",
  "details": ["도움이 되는 추가 설명 항목들 (짧게)"],
  "warning": "금액·날짜는 꼭 다시 확인하시라는 안내 한 문장"
}
규칙: 금액이나 날짜가 흐릿하거나 불명확하면 그 필드는 null로 두고, mainAction에서 '금액이 잘 안 보이니 다시 확인하세요'처럼 솔직히 말하세요. 절대 추측하지 마세요.`,

  phishing: `당신은 어르신을 보이스피싱·스미싱으로부터 보호하는 도우미입니다. 아래 문자메시지/메신저/화면 내용을 보고 아래 JSON만 출력하세요.
${PRIVACY_RULES}

출력 JSON 스키마:
{
  "risk": "높음" | "의심" | "확인불가",
  "reasons": ["왜 위험/의심스러운지 이유들 (짧고 쉽게)"],
  "dontDo": ["절대 하지 말 것 (예: '돈을 보내지 마세요', '앱을 깔지 마세요', '링크를 누르지 마세요')"],
  "verifyHow": "공식 대표번호로 직접 확인하라는 안내 한 문장"
}
절대 규칙: 어떤 경우에도 'risk'를 '안전'이라고 하지 마세요. 안전해 보여도 최소 '확인불가'입니다. 조금이라도 의심되면 '의심' 또는 '높음'을 쓰세요. 확신이 없으면 '확인불가'.`,

  kiosk: `당신은 무인기계(키오스크) 사용을 돕는 도우미입니다. 사진 속 화면을 보고 아래 JSON만 출력하세요.
${PRIVACY_RULES}

출력 JSON 스키마:
{
  "screenIs": "지금 이 화면이 어떤 화면인지 한 문장",
  "nextStep": "다음에 무엇을 하면 되는지 단계·맥락 설명 (정확한 버튼 위치·좌표는 짚지 마세요)",
  "caution": "주의할 점 한 문장 (없으면 null)"
}
매우 중요한 안전 규칙: 만약 이 화면이 결제(카드·현금), 비밀번호 입력, 주민번호·개인정보 입력 화면으로 보이면, nextStep은 반드시 정확히 이렇게 쓰세요: "여기서는 직접 누르지 마시고, 옆에 직원이나 도와줄 사람에게 부탁하세요." 결제·비밀번호 입력 과정을 절대 단계별로 안내하지 마세요.`,

  medicine: `당신은 약 정보를 쉽게 설명하는 도우미입니다. 사진 속 약봉투/약통/처방전의 '공식적으로 인쇄된 약 정보'를 읽고 아래 JSON만 출력하세요.
${PRIVACY_RULES}

출력 JSON 스키마:
{
  "mainInfo": "무슨 약인지 + 언제 드시는지 한 문장 (가장 크게 보여줄 핵심)",
  "whatFor": "이 약이 하는 일 (인쇄된 효능 기준; 불명확하면 null)",
  "howToTake": ["복용 방법 항목들 (예: '하루 3번', '식후 30분'). 인쇄된 대로만."],
  "cautions": ["주의사항 (인쇄된 대로만; 없으면 빈 배열)"],
  "warning": "정확한 것은 의사·약사에게 확인하시라는 안내 한 문장"
}
의료 안전 규칙(엄수): 인쇄된/공식 약 정보에만 근거하세요. 절대로 약을 끊거나·바꾸거나·용량을 조절하라고 말하지 마세요. 진단하지 마세요. 반드시 warning에 "정확한 것은 의사·약사에게 확인하세요."를 포함하세요.
개인정보: 환자 이름, 주민번호, 그리고 병명·진단명은 출력에 절대 포함하지 마세요. 사용자는 '약'에 대해 알고 싶은 것이지 진단명을 다시 노출하려는 것이 아닙니다.`,
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function parseImage(raw: string): { data: string; mediaType: string } | null {
  // Accept data URL (data:image/jpeg;base64,....) or bare base64
  const dataUrl = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/)
  if (dataUrl) {
    return { mediaType: dataUrl[1]!, data: dataUrl[2]! }
  }
  // Bare base64 — default to jpeg
  return { mediaType: 'image/jpeg', data: raw }
}

// ── Text-only path (phishing mode) ───────────────────────────────────────────────

async function runTextAnalysis(textContent: string, mode: PhotoMode, apiKey: string): Promise<Response> {
  const system = MODE_PROMPTS[mode]
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
        max_tokens: 900,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `다음 문자 내용을 분석하고 지시대로 JSON만 출력하세요:\n\n"""\n${textContent.slice(0, 3000)}\n"""`,
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[photo-analyze/text] anthropic http ${res.status}`)
      return NextResponse.json(
        { error: 'Analysis failed', detail: `http-${res.status}: ${errText.slice(0, 200)}` },
        { status: 502 }
      )
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)

    const responseText = json.content?.find((b) => b.type === 'text')?.text ?? ''
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({
        unreadable: true,
        message: '내용을 확인하지 못했어요. 다시 시도해 주세요.',
      })
    }

    let result: Record<string, unknown>
    try {
      result = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    } catch {
      return NextResponse.json({
        unreadable: true,
        message: '내용을 확인하지 못했어요. 다시 시도해 주세요.',
      })
    }

    return NextResponse.json({ mode, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[photo-analyze/text] error:', message)
    return NextResponse.json({ error: 'Analysis failed', detail: message }, { status: 500 })
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const mode = body.mode as PhotoMode
  if (!MODES.includes(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  // Phishing mode: accept plain text instead of an image.
  const textInput = mode === 'phishing' && typeof body.text === 'string' ? body.text.trim() : ''
  if (textInput) {
    return runTextAnalysis(textInput, mode, apiKey)
  }

  // Image path — required for all modes when no text provided.
  const rawImage = typeof body.image === 'string' ? body.image : ''
  if (!rawImage) {
    return NextResponse.json({ error: 'Missing image' }, { status: 400 })
  }

  const parsed = parseImage(rawImage)
  if (!parsed) {
    return NextResponse.json({ error: 'Unsupported image format' }, { status: 400 })
  }

  // Honor an explicit mediaType if the client sent a bare base64 blob.
  let mediaType = typeof body.mediaType === 'string' ? body.mediaType : parsed.mediaType
  if (!ALLOWED_MEDIA.includes(mediaType)) mediaType = 'image/jpeg'

  const system = MODE_PROMPTS[mode]

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
        max_tokens: 900,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: parsed.data },
              },
              { type: 'text', text: '이 사진을 보고 지시대로 JSON만 출력하세요.' },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      // Do NOT log image content; only the API error status.
      console.error(`[photo-analyze] anthropic http ${res.status}`)
      return NextResponse.json(
        { error: 'Vision analysis failed', detail: `http-${res.status}: ${errText.slice(0, 200)}` },
        { status: 502 }
      )
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)

    const rawText = json.content?.find((b) => b.type === 'text')?.text ?? ''
    const match = rawText.match(/\{[\s\S]*\}/)
    if (!match) {
      return NextResponse.json({
        unreadable: true,
        message: '사진이 잘 안 보여요. 밝은 곳에서 다시 찍어주세요.',
      })
    }

    let result: Record<string, unknown>
    try {
      result = JSON.parse(match[0]) as Record<string, unknown>
    } catch {
      return NextResponse.json({
        unreadable: true,
        message: '사진이 잘 안 보여요. 밝은 곳에서 다시 찍어주세요.',
      })
    }

    // NOTE: nothing here is persisted — the parsed image is dropped when this
    // function returns and the response is sent.
    return NextResponse.json({ mode, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[photo-analyze] error:', message)
    return NextResponse.json({ error: 'Vision analysis failed', detail: message }, { status: 500 })
  }
}
