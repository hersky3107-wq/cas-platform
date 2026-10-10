import { NextResponse } from 'next/server'
import { ADMIN_EMAIL } from '@/lib/admin/require-admin'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function isUserAdmin(userId: string, email?: string | null): Promise<boolean> {
  if (email) return email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
    return (data?.user?.email ?? '').toLowerCase() === ADMIN_EMAIL.toLowerCase()
  } catch {
    return false
  }
}

export async function requireCrisisUser(
  req: Request,
  body?: Record<string, unknown>,
): Promise<{ userId: string; email: string | null; isAdmin: boolean } | { response: NextResponse }> {
  const { user } = await resolveRouteAuth(req, body)
  if (!user?.id) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const email = user.email ?? null
  const isAdmin = Boolean(email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase())
  return { userId: user.id, email, isAdmin }
}
