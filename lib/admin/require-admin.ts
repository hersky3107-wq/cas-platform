import { NextResponse } from 'next/server'
import { createSupabaseRouteAuthClient } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export const ADMIN_EMAIL = 'hersky3107@gmail.com'

/** Returns 403 response if caller is not the admin; otherwise null. */
export async function requireAdmin(req: Request): Promise<NextResponse | null> {
  const authClient = await createSupabaseRouteAuthClient(req)
  const authHeader = req.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
  const {
    data: { session },
  } = await authClient.auth.getSession()
  const jwt = bearer ?? session?.access_token
  if (!jwt) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(jwt)
  const email = user?.email ?? ''
  if (error || !email || email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

/** Admin identity for writes (graded_by). 403 response when not the owner. */
export async function requireAdminUser(
  req: Request
): Promise<{ userId: string } | { response: NextResponse }> {
  const forbidden = await requireAdmin(req)
  if (forbidden) return { response: forbidden }

  const authHeader = req.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
  let jwt = bearer
  if (!jwt) {
    const authClient = await createSupabaseRouteAuthClient(req)
    const {
      data: { session },
    } = await authClient.auth.getSession()
    jwt = session?.access_token
  }
  if (!jwt) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const { data, error } = await supabaseAdmin.auth.getUser(jwt)
  if (error || !data.user?.id) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  if (!data.user.email || data.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { userId: data.user.id }
}
