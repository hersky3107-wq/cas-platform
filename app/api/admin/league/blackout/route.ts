import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { listKrBlackoutAlerts } from '@/lib/league/politics/blackout-alert'
import { dispatchKrElectionAlerts, listKrElectionRiskWindows } from '@/lib/league/politics/kr-election-alerts'
import {
  krManualCloseIsOn,
  parseKrManualCloseFlag,
  serializeKrManualCloseFlag,
} from '@/lib/league/politics/kr-manual-close'
import { loadKrManualCloseFlag, saveKrManualCloseFlag, supabaseKrElectionAlertStore } from '@/lib/league/politics/kr-election-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  const atMs = Date.now()
  const alerts = listKrBlackoutAlerts(atMs)
  const windows = listKrElectionRiskWindows(atMs)
  const closeFlag = await loadKrManualCloseFlag()
  const telegram = await dispatchKrElectionAlerts({
    atMs,
    store: supabaseKrElectionAlertStore(),
  }).catch(() => ({ sent: [] as Array<{ electionId: string; milestone: string }> }))
  return NextResponse.json({
    active: windows.length > 0,
    count: windows.length || alerts.length,
    alerts,
    windows,
    telegramSent: telegram.sent,
    switch: {
      on: krManualCloseIsOn(closeFlag),
      value: serializeKrManualCloseFlag(closeFlag),
    },
  })
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  let body: { value?: unknown }
  try {
    body = (await req.json()) as { value?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const flag = parseKrManualCloseFlag(typeof body.value === 'string' ? body.value : '')
  try {
    await saveKrManualCloseFlag(flag)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to save switch' },
      { status: 500 },
    )
  }
  return NextResponse.json({
    ok: true,
    switch: { on: krManualCloseIsOn(flag), value: serializeKrManualCloseFlag(flag) },
  })
}
