import { NextResponse } from 'next/server'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { createSupabaseRouteAuthClient } from '@/lib/supabase/route-auth'
import { SURVEY_QUESTIONS, SURVEY_SIJIN_ANCHORS, type SurveyAnswersExpected } from '@/lib/oracle/survey-data'

const INF_MODEL = 'claude-sonnet-4-6'

function coerceJson(raw: string): {
  sijin_kr: string | null
  midpoint_24h: string | null
} {
  try {
    const t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(t) as Record<string, unknown>
    const sijin_kr =
      typeof parsed.sijin_kr === 'string'
        ? parsed.sijin_kr.trim()
        : typeof parsed.pillar === 'string'
          ? parsed.pillar.trim()
          : null
    const midpoint_24h =
      typeof parsed.midpoint_24h === 'string'
        ? parsed.midpoint_24h.trim()
        : typeof parsed.time === 'string'
          ? parsed.time.trim()
          : null
    return { sijin_kr, midpoint_24h }
  } catch {
    return { sijin_kr: null, midpoint_24h: null }
  }
}

function validateHHMM(s: string): boolean {
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(s)
}

const DEFAULT_SIJIN: Record<string, { kr: string; hhmm: string }> = {
  子時: { kr: '子時', hhmm: '00:00' },
  丑時: { kr: '丑時', hhmm: '02:00' },
  寅時: { kr: '寅時', hhmm: '04:00' },
  卯時: { kr: '卯時', hhmm: '06:00' },
  辰時: { kr: '辰時', hhmm: '08:00' },
  巳時: { kr: '巳時', hhmm: '10:00' },
  午時: { kr: '午時', hhmm: '12:00' },
  未時: { kr: '未時', hhmm: '14:00' },
  申時: { kr: '申時', hhmm: '16:00' },
  酉時: { kr: '酉時', hhmm: '18:00' },
  戌時: { kr: '戌時', hhmm: '20:00' },
  亥時: { kr: '亥時', hhmm: '22:00' },
}

function midpointFromKr(kr: string): string | null {
  for (const v of Object.values(DEFAULT_SIJIN)) {
    if (v.kr === kr) return v.hhmm
  }
  return null
}

function normalizeAnswers(answers: Record<string, unknown>): SurveyAnswersExpected | null {
  const out: Partial<SurveyAnswersExpected> = {}
  for (const q of SURVEY_QUESTIONS) {
    const ix = answers[q.id]
    if (typeof ix !== 'number' || ix < 0 || ix >= q.choices.length) return null
    out[q.id] = ix
  }
  return out as SurveyAnswersExpected
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawAnswers = body.answers
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return NextResponse.json({ error: 'answers object required (q1..q15 indices)' }, { status: 400 })
  }
  const answers = normalizeAnswers(rawAnswers as Record<string, unknown>)
  if (!answers) {
    return NextResponse.json({ error: 'Every survey question (q1-q15) requires a valid option index' }, { status: 400 })
  }

  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined
  const supabaseAuth = token ? createSupabaseWithToken(token) : await createSupabaseRouteAuthClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  function q1FallbackMidpoint(resolved: SurveyAnswersExpected): { kr: string; hhmm: string } {
    const qone = SURVEY_QUESTIONS[0]
    const ix = resolved.q1
    const ch = qone.choices[ix]
    const hit = ch ? SURVEY_SIJIN_ANCHORS[ch] : undefined
    if (hit) return { kr: hit.kr, hhmm: hit.midpointHHMM }
    return { kr: '午時', hhmm: '12:00' }
  }

  const lines = SURVEY_QUESTIONS.map((q) => {
    const ix = answers[q.id]
    return `${q.text}\nSelected: "${q.choices[ix]}"`
  }).join('\n\n')

  const prompt = `${lines}\n\nFrom these answers infer the person's most plausible birth-hour pillar among the Korean 12 two-hour shi-chen markers (子時‥亥時).\nRespond ONLY JSON: {\"sijin_kr\":\"午時\",\"midpoint_24h\":\"HH:mm\"}`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const fb = q1FallbackMidpoint(answers)
    return NextResponse.json({
      ok: true,
      sijin_kr: fb.kr,
      midpoint_24h: fb.hhmm,
      fallback: true,
    })
  }

  let text = ''
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: INF_MODEL,
        max_tokens: 512,
        system:
          'You assign traditional Korean shi-chen (2-hour pillars) cautiously using survey correlations. Reply JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      throw new Error('anthropic-http')
    }
    const json: any = await res.json()
    text = Array.isArray(json?.content)
      ? json.content.map((b: any) => b?.text).filter(Boolean).join('\n')
      : ''
  } catch {
    text = ''
  }

  let parsed = coerceJson(text)
  if (!(parsed.midpoint_24h && validateHHMM(parsed.midpoint_24h)) && parsed.sijin_kr) {
    const mid = midpointFromKr(parsed.sijin_kr)
    if (mid) parsed = { ...parsed, midpoint_24h: mid }
  }

  if (!(parsed.midpoint_24h && validateHHMM(parsed.midpoint_24h))) {
    const fb = q1FallbackMidpoint(answers)
    return NextResponse.json({
      ok: true,
      sijin_kr: fb.kr,
      midpoint_24h: fb.hhmm,
      fallback: true,
    })
  }

  if (!parsed.sijin_kr) {
    for (const [, v] of Object.entries(DEFAULT_SIJIN)) {
      if (v.hhmm === parsed.midpoint_24h) parsed = { ...parsed, sijin_kr: v.kr }
    }
  }

  return NextResponse.json({
    ok: true,
    sijin_kr: parsed.sijin_kr ?? q1FallbackMidpoint(answers).kr,
    midpoint_24h: parsed.midpoint_24h,
    fallback: false,
  })
}
