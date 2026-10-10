import { NextResponse } from 'next/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'

export async function requireCrisisUser(
  req: Request,
  body?: Record<string, unknown>,
): Promise<{ userId: string; email: string | null } | { response: NextResponse }> {
  const { user } = await resolveRouteAuth(req, body)
  if (!user?.id) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { userId: user.id, email: user.email ?? null }
}
