import { generateJejuLiteBriefing } from '@/lib/jeju/brief'

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

  try {
    const result = await generateJejuLiteBriefing({ question })
    return Response.json(result)
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error }, { status: 500 })
  }
}
