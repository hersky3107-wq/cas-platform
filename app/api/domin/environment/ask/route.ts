import { NextResponse } from 'next/server'

import { askEnvironment } from '@/lib/jeju/environment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/domin/environment/ask — { question } → Perplexity 분리배출 답변.
 * One Perplexity call per question. Returns { ok, question, answer, contextMeta }.
 * Never throws; errors surface as { ok:false, error }.
 */
export async function POST(req: Request) {
  let question = ''
  try {
    const body = (await req.json()) as { question?: unknown }
    question = typeof body?.question === 'string' ? body.question : ''
  } catch {
    question = ''
  }

  try {
    const result = await askEnvironment(question)
    return NextResponse.json(result, { status: 200 })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, question, answer: '', error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
