import { NextResponse } from 'next/server'
import type { WelfareProfile } from '@/lib/jeju/welfare'

export const runtime = 'nodejs'

const MODEL = 'claude-sonnet-4-6'

const PROFILE_KEYS: (keyof WelfareProfile)[] = [
  'isElderly',
  'hasDisability',
  'isLowIncome',
  'livesAlone',
  'seeksJob',
  'needsCare',
]

/** Controlled situation vocabulary — the AI may only use these tags, never invent programs. */
const SITUATION_VOCAB = [
  '일자리',
  '의료비',
  '돌봄',
  '주거',
  '출산',
  '양육',
  '생계',
  '교육',
  '문화여가',
  '법률',
  '안전',
]

function coerceBoolOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  return null
}

function sanitizeProfile(body: unknown): WelfareProfile {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const p = {} as WelfareProfile
  for (const k of PROFILE_KEYS) p[k] = coerceBoolOrNull(src[k])
  return p
}

interface InterpretResult {
  profile: WelfareProfile
  extraSituations: string[]
  interpreted: boolean
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const baseProfile = sanitizeProfile(body.profile)
  const freeText = typeof body.freeText === 'string' ? body.freeText.trim() : ''

  // No text → nothing to interpret; return the profile untouched.
  if (!freeText) {
    const result: InterpretResult = {
      profile: baseProfile,
      extraSituations: [],
      interpreted: false,
    }
    return NextResponse.json(result)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Silent fallback — never block results.
    const result: InterpretResult = {
      profile: baseProfile,
      extraSituations: [],
      interpreted: false,
    }
    return NextResponse.json(result)
  }

  const system = `당신은 제주 복지 신청자의 자유 서술을 읽고, 이미 존재하는 태그 어휘로만 해석하는 도우미입니다.
새로운 복지제도나 자격을 절대 만들어내지 마세요. 오직 사용자가 적은 내용을 아래 태그로만 옮기세요.
확실하지 않으면 null 또는 빈 배열을 사용하세요. 마크다운 없이 순수 JSON만 출력하세요.

출력 JSON 스키마:
{
  "isElderly": boolean | null,      // 만 65세 이상 언급
  "hasDisability": boolean | null,  // 장애/거동 불편 언급
  "isLowIncome": boolean | null,    // 형편 어려움/저소득 언급
  "livesAlone": boolean | null,     // 혼자 지냄/독거 언급
  "seeksJob": boolean | null,       // 일자리/구직 언급
  "needsCare": boolean | null,      // 돌봄/간병/요양 필요 언급
  "extraSituations": string[]       // 다음 중에서만: ${SITUATION_VOCAB.join(', ')}
}

각 boolean은 텍스트에서 명확히 드러날 때만 true로, 아니라고 하면 false로, 언급이 없으면 null로 두세요.`

  const user = `사용자가 적은 내용:\n"""${freeText.slice(0, 1200)}"""\n\n위 내용을 태그로만 해석해 JSON으로 답하세요.`

  let aiObj: Record<string, unknown> | null = null
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
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) throw new Error(`anthropic-http-${res.status}`)
    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)
    const rawText = json.content?.find((b) => b.type === 'text')?.text ?? ''
    const match = rawText.match(/\{[\s\S]*\}/)
    if (match) aiObj = JSON.parse(match[0]) as Record<string, unknown>
  } catch (e) {
    console.error('[interpret] AI call failed, falling back:', e instanceof Error ? e.message : e)
    aiObj = null
  }

  // Merge: only fill fields the user left as null (모르겠어요). Never override explicit answers.
  const merged: WelfareProfile = { ...baseProfile }
  if (aiObj) {
    for (const k of PROFILE_KEYS) {
      if (merged[k] === null) {
        const v = coerceBoolOrNull(aiObj[k])
        if (v !== null) merged[k] = v
      }
    }
  }

  const extraSituations = Array.isArray(aiObj?.extraSituations)
    ? (aiObj!.extraSituations as unknown[])
        .filter((s): s is string => typeof s === 'string' && SITUATION_VOCAB.includes(s))
    : []

  const result: InterpretResult = {
    profile: merged,
    extraSituations,
    interpreted: aiObj !== null,
  }
  return NextResponse.json(result)
}
