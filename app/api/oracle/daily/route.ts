import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Legacy LLM-only daily stream. 오늘의 운세 now runs on the 12-system runner
 * via POST /api/oracle/session (kind=daily). This route must not charge the
 * old 3-credit panel.
 */
export async function POST() {
  return NextResponse.json(
    { error: '오늘의 운세 moved to /api/oracle/session (kind=daily)' },
    { status: 410 },
  )
}

export async function GET() {
  return NextResponse.json(
    { error: '오늘의 운세 moved to /api/oracle/session (kind=daily)' },
    { status: 410 },
  )
}
