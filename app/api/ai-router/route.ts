import { NextResponse } from 'next/server'
import { routeAI, AiProviderName } from '@/lib/ai/router'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
    const systemPrompt = typeof body?.systemPrompt === 'string' ? body.systemPrompt : ''
    const providers = Array.isArray(body?.providers) ? (body.providers as AiProviderName[]) : []
    const supabaseAccessToken =
      typeof body?.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

    if (!prompt.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    const out = await routeAI({
      prompt,
      systemPrompt,
      providers,
      supabaseAccessToken,
    })

    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ? String(e.message) : 'Unknown error' },
      { status: 500 }
    )
  }
}

