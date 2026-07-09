import { NextResponse } from 'next/server'
import { matchWelfare, type WelfareProfile } from '@/lib/care/welfare'

export const runtime = 'nodejs'

const PROFILE_KEYS: (keyof WelfareProfile)[] = [
  'isElderly',
  'hasDisability',
  'isLowIncome',
  'livesAlone',
  'seeksJob',
  'needsCare',
]

/** Accepts booleans or null; coerces missing keys to null. Rejects other types. */
function parseProfile(body: unknown): WelfareProfile | null {
  if (!body || typeof body !== 'object') return null
  const src = body as Record<string, unknown>

  const profile: Partial<WelfareProfile> = {}
  for (const key of PROFILE_KEYS) {
    const val = src[key]
    if (val === undefined || val === null) {
      profile[key] = null
    } else if (typeof val === 'boolean') {
      profile[key] = val
    } else {
      // Any non-boolean, non-null value is invalid.
      return null
    }
  }

  // Require at least one non-null answer so we don't rank against an empty profile.
  const answered = PROFILE_KEYS.some((k) => profile[k] !== null)
  if (!answered) return null

  return profile as WelfareProfile
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const bodyObj = (body ?? {}) as Record<string, unknown>
  const profile = parseProfile(bodyObj)
  if (!profile) {
    return NextResponse.json(
      { error: 'Invalid profile: expected boolean|null values, at least one answered' },
      { status: 400 }
    )
  }

  const region = typeof bodyObj.region === 'string' && bodyObj.region ? bodyObj.region : 'jeju'
  const limit =
    typeof bodyObj.limit === 'number' && bodyObj.limit > 0 && bodyObj.limit <= 50
      ? Math.floor(bodyObj.limit)
      : 8

  try {
    const results = await matchWelfare(profile, region, limit)
    return NextResponse.json({ region, count: results.length, results })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[welfare-match] error:', message)
    return NextResponse.json({ error: 'Welfare matching failed', detail: message }, { status: 500 })
  }
}
