import { runJejuMediaWatch } from '@/lib/jeju/mediawatch'
import type { JejuMediaWatchMode } from '@/lib/jeju/mediawatch'

export const runtime = 'nodejs'
export const maxDuration = 60

// TODO: credit/auth gating before public launch

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — mode is optional
  }

  const mode: JejuMediaWatchMode =
    body.mode === 'resident' ? 'resident' : 'governance'

  try {
    const result = await runJejuMediaWatch({ mode })
    return Response.json(result)
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error }, { status: 500 })
  }
}
