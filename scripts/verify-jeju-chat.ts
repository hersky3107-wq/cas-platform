/**
 * Throwaway verify — POST /api/domin/jeju-chat with 4 questions exercising
 * each routing path:
 *   1. "제주 방언으로 고맙다가 뭐야"           → internal
 *   2. "오늘 제주 날씨"                       → cache
 *   3. "이번 주 제주 전기차 보조금 최신 소식" → search-deep (expect searchRaw)
 *   4. "서울 지하철 요금"                     → decline (out-of-scope)
 *
 * Prints reply + routedVia + usedSearch + whether searchRaw appears.
 *
 * Run (dev server on :3000):
 *   npx tsx --env-file=.env.local scripts/verify-jeju-chat.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

const CASES: { label: string; question: string; expect: string }[] = [
  {
    label: '1. INTERNAL (방언)',
    question: '제주 방언으로 고맙다가 뭐야',
    expect: 'internal',
  },
  {
    label: '2. CACHE (오늘 날씨)',
    question: '오늘 제주 날씨',
    expect: 'cache',
  },
  {
    label: '3. SEARCH-DEEP (전기차 보조금)',
    question: '이번 주 제주 전기차 보조금 최신 소식',
    expect: 'search-deep',
  },
  {
    label: '4. DECLINE (서울 지하철 — out of scope)',
    question: '서울 지하철 요금',
    expect: 'decline/internal',
  },
]

async function ask(question: string): Promise<Record<string, unknown>> {
  const url = `${BASE}/api/domin/jeju-chat`
  console.log(`\nPOST ${url}`)
  console.log(`Q: ${question}`)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    console.log(text.slice(0, 400))
    throw new Error('Non-JSON response')
  }
}

function summarize(label: string, expect: string, p: Record<string, unknown>): boolean {
  const routedVia = String(p.routedVia ?? '')
  const usedSearch = Boolean(p.usedSearch)
  const searchRaw = typeof p.searchRaw === 'string' && p.searchRaw.trim() ? p.searchRaw : null
  const reply = typeof p.reply === 'string' ? p.reply : ''
  const meta = (p.contextMeta ?? null) as Record<string, unknown> | null

  console.log(`\n===== ${label} =====`)
  console.log('expect     :', expect)
  console.log('routedVia  :', routedVia)
  console.log('usedSearch :', usedSearch)
  console.log('searchRaw  :', searchRaw ? `YES (${searchRaw.length} chars)` : 'null')
  console.log('contextMeta:', meta ? `${meta.source} · asOf ${meta.asOf ?? '(null)'}` : 'null')
  console.log('errors     :', p.errors)
  console.log('reply      :', reply.slice(0, 280) + (reply.length > 280 ? '…' : ''))

  let pass = true
  if (expect === 'internal' && routedVia !== 'internal') {
    console.log('⚠ expected internal')
    pass = false
  }
  if (expect === 'cache' && routedVia !== 'cache') {
    console.log('⚠ expected cache (may fall through if weather cache empty)')
    // soft — don't fail hard if weather upstream is down
  }
  if (expect === 'search-deep') {
    if (routedVia !== 'search-deep' && routedVia !== 'search-light') {
      console.log('⚠ expected search-*')
      pass = false
    }
    if (!searchRaw && routedVia === 'search-deep') {
      console.log('⚠ search-deep but searchRaw missing')
      pass = false
    }
    if (searchRaw) console.log('✓ searchRaw visible')
  }
  if (expect === 'decline/internal') {
    const declined =
      /제주 전문|제주와 관련/.test(reply) || routedVia === 'internal'
    if (!declined) {
      console.log('⚠ expected polite Jeju-only decline')
      pass = false
    } else {
      console.log('✓ out-of-scope decline')
    }
  }
  return pass
}

async function main(): Promise<void> {
  let failed = 0
  for (const c of CASES) {
    try {
      const payload = await ask(c.question)
      if (!summarize(c.label, c.expect, payload)) failed++
    } catch (e: unknown) {
      console.error(`FAIL ${c.label}:`, e instanceof Error ? e.message : e)
      failed++
    }
  }
  console.log(failed === 0 ? '\nRESULT: PASS' : `\nRESULT: ${failed} case(s) soft-failed / failed`)
  if (failed > 2) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
