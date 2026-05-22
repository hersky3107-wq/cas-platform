import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/server'

function startOfTodayUtc(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function sevenDaysAgoUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString()
}

async function countAuthUsersCreatedSince(iso: string): Promise<number> {
  let page = 1
  const perPage = 200
  let total = 0
  const since = new Date(iso).getTime()

  while (page <= 50) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.warn('[admin/stats] listUsers failed:', error.message)
      return 0
    }
    const users = data.users ?? []
    if (!users.length) break
    for (const u of users) {
      const created = u.created_at ? new Date(u.created_at).getTime() : 0
      if (created >= since) total += 1
    }
    if (users.length < perPage) break
    page += 1
  }
  return total
}

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const todayStart = startOfTodayUtc()
  const weekStart = sevenDaysAgoUtc()

  const overview = {
    totalUsers: 0,
    newUsersToday: 0,
    totalSessions: 0,
    sessionsToday: 0,
  }

  const { count: totalUsers, error: usersCountErr } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
  if (!usersCountErr && totalUsers != null) overview.totalUsers = totalUsers

  const { count: newUsersDb, error: newUsersErr } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', todayStart)
  if (!newUsersErr && newUsersDb != null) {
    overview.newUsersToday = newUsersDb
  } else {
    overview.newUsersToday = await countAuthUsersCreatedSince(todayStart)
  }

  const { count: totalSessions, error: sessErr } = await supabaseAdmin
    .from('sessions')
    .select('*', { count: 'exact', head: true })
  if (!sessErr && totalSessions != null) overview.totalSessions = totalSessions

  const { count: sessionsToday, error: sessTodayErr } = await supabaseAdmin
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', todayStart)
  if (!sessTodayErr && sessionsToday != null) overview.sessionsToday = sessionsToday

  const { data: weekSessions, error: weekErr } = await supabaseAdmin
    .from('sessions')
    .select('mode')
    .gte('created_at', weekStart)
    .limit(50000)
  if (weekErr) {
    return NextResponse.json({ error: weekErr.message }, { status: 500 })
  }

  const modeCounts = new Map<string, number>()
  for (const row of weekSessions ?? []) {
    const mode = String((row as { mode?: string }).mode ?? 'unknown').trim() || 'unknown'
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1)
  }
  const moduleUsage = [...modeCounts.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const maxModuleCount = moduleUsage[0]?.count ?? 1

  let totalCreditsIssued = 0
  const { data: creditRows, error: creditsErr } = await supabaseAdmin.from('users').select('credits')
  if (!creditsErr) {
    for (const r of creditRows ?? []) {
      const c = (r as { credits?: number }).credits
      if (typeof c === 'number' && Number.isFinite(c)) totalCreditsIssued += c
    }
  }

  const { count: paypalPurchaseCount, error: paypalCountErr } = await supabaseAdmin
    .from('paypal_credit_purchases')
    .select('*', { count: 'exact', head: true })
  if (paypalCountErr) {
    return NextResponse.json({ error: paypalCountErr.message }, { status: 500 })
  }

  let revenueEstimateUsd = 0
  const { data: paypalRows, error: paypalSumErr } = await supabaseAdmin
    .from('paypal_credit_purchases')
    .select('amount_usd, credits_granted')
  if (paypalSumErr) {
    return NextResponse.json({ error: paypalSumErr.message }, { status: 500 })
  }
  for (const r of paypalRows ?? []) {
    const row = r as { amount_usd?: number | string; credits_granted?: number }
    const amt = typeof row.amount_usd === 'number' ? row.amount_usd : Number(row.amount_usd)
    if (Number.isFinite(amt)) revenueEstimateUsd += amt
  }

  const { data: recentRows, error: recentErr } = await supabaseAdmin
    .from('users')
    .select('id, email, created_at, credits')
    .order('created_at', { ascending: false })
    .limit(10)
  if (recentErr) {
    return NextResponse.json({ error: recentErr.message }, { status: 500 })
  }

  const recentSignups: {
    id: string
    email: string
    created_at: string
    credits: number
  }[] = []

  for (const row of recentRows ?? []) {
    const id = String((row as { id?: string }).id ?? '')
    if (!id) continue
    let email = typeof (row as { email?: string }).email === 'string' ? (row as { email: string }).email : ''
    if (!email) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(id)
      email = authUser?.user?.email ?? ''
    }
    const created_at = String((row as { created_at?: string }).created_at ?? '')
    const credits =
      typeof (row as { credits?: number }).credits === 'number' ? (row as { credits: number }).credits : 0
    recentSignups.push({ id, email: email || '—', created_at, credits })
  }

  return NextResponse.json({
    overview,
    moduleUsage,
    maxModuleCount,
    credits: {
      totalCreditsIssued,
      paypalPurchaseCount: paypalPurchaseCount ?? 0,
      revenueEstimateUsd: Math.round(revenueEstimateUsd * 100) / 100,
    },
    recentSignups,
  })
}
