import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { listKrBlackoutAlerts, notifyKrBlackoutEntered } from '@/lib/league/politics/blackout-alert'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  const alerts = listKrBlackoutAlerts()
  const telegram = await notifyKrBlackoutEntered().catch(() => ({ sent: [] as string[] }))
  return NextResponse.json({
    active: alerts.length > 0,
    count: alerts.length,
    alerts,
    telegramSent: telegram.sent,
  })
}
