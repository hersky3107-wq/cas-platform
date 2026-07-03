import { generateJejuLiteBriefing } from '@/lib/motie/brief'

export const runtime = 'nodejs'
export const maxDuration = 60

// TODO: credit/auth gating before public launch

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — question is optional
  }

  const question =
    typeof body.question === 'string' && body.question.trim()
      ? body.question.trim()
      : undefined

  // AX COUNCIL trade/warroom mode — branches the data layer (trade → KOTRA/FX).
  const councilMode: 'trade' | 'warroom' = body.councilMode === 'warroom' ? 'warroom' : 'trade'

  try {
    const result = await generateJejuLiteBriefing({ question, councilMode })
    return Response.json(result)
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error }, { status: 500 })
  }
}
