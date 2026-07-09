/**
 * Throwaway verify — GET /api/domin/environment (+ POST .../ask). Prints:
 *   - 미세먼지 (dust): PM10/PM2.5 값 + 등급 + alert
 *   - a few 클린하우스/재활용도움센터 centers
 *   - context + contextMeta
 *   - a sample /ask call ("폐형광등 어디에 버려요?")
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Falls back to calling the lib directly.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/verify-environment.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

async function getViaHttp(): Promise<unknown> {
  const url = `${BASE}/api/domin/environment`
  console.log(`GET ${url}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { Accept: 'application/json' } })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    console.log(text.slice(0, 500))
    throw new Error('Non-JSON response from route')
  }
}

async function getViaDirect(): Promise<unknown> {
  console.log('(dev server unreachable — calling getEnvironment() directly)')
  const { getEnvironment } = await import('../lib/jeju/environment')
  return getEnvironment()
}

async function askViaHttp(question: string): Promise<unknown> {
  const url = `${BASE}/api/domin/environment/ask`
  console.log(`\nPOST ${url}  { question: "${question}" }`)
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ question }),
  })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    console.log(text.slice(0, 500))
    throw new Error('Non-JSON response from /ask')
  }
}

async function askViaDirect(question: string): Promise<unknown> {
  const { askEnvironment } = await import('../lib/jeju/environment')
  return askEnvironment(question)
}

function summarize(p: unknown): void {
  if (!p || typeof p !== 'object') { console.log('Unexpected payload:', p); return }
  const data = p as Record<string, unknown>
  const dust = (data.dust ?? null) as Record<string, unknown> | null
  const centers = (data.centers ?? {}) as Record<string, unknown>
  const meta = (data.contextMeta ?? {}) as Record<string, unknown>

  console.log('\n── summary ──')
  console.log('ok         :', data.ok)
  console.log('errors     :', data.errors)

  console.log('\n── 미세먼지 (dust) ──')
  if (dust) {
    console.log(`  PM10  : ${dust.pm10 ?? '─'} (${dust.pm10Grade ?? '─'})`)
    console.log(`  PM2.5 : ${dust.pm25 ?? '─'} (${dust.pm25Grade ?? '─'})`)
    console.log(`  경보   : ${dust.alert ?? '없음'}`)
    console.log(`  측정소 : ${dust.station ?? '─'} / ${dust.measuredAt ?? '─'}`)
  } else {
    console.log('  (정보 없음)')
  }

  console.log('\n── 클린하우스/재활용도움센터 ──')
  const nearest = centers.nearest as unknown[] | undefined
  const byDong = centers.byDong as Record<string, unknown[]> | undefined
  if (Array.isArray(nearest)) {
    for (const c of nearest.slice(0, 6)) {
      const it = c as Record<string, unknown>
      console.log(`  ${String(it.name).padEnd(28)} ${it.distanceKm ?? '?'}km  [${(it.items as string[])?.join(', ')}]`)
    }
  } else if (byDong) {
    const dongs = Object.keys(byDong)
    console.log(`  ${dongs.length}개 읍면동:`, dongs.join(', '))
    for (const dong of dongs.slice(0, 4)) {
      for (const c of byDong[dong].slice(0, 1)) {
        const it = c as Record<string, unknown>
        console.log(`  · ${dong}: ${it.name} (${it.hours})`)
      }
    }
  } else {
    console.log('  (정보 없음)')
  }

  console.log('\n── context (배출요일제/분리배출) ──')
  console.log(data.context || '(empty)')
  console.log('\n── contextMeta ──')
  console.log('source      :', meta.source)
  console.log('retrievedAt :', meta.retrievedAt)
  console.log('asOf        :', meta.asOf ?? '(null)')
  console.log('\nfreshness  :', data.freshnessNote)
  console.log('updatedAt  :', data.updatedAt)
}

function summarizeAsk(p: unknown): void {
  if (!p || typeof p !== 'object') { console.log('Unexpected /ask payload:', p); return }
  const data = p as Record<string, unknown>
  const meta = (data.contextMeta ?? {}) as Record<string, unknown>
  console.log('\n── /ask 결과 ──')
  console.log('ok      :', data.ok)
  console.log('question:', data.question)
  console.log('answer  :', data.answer || '(empty)')
  console.log('error   :', data.error ?? '(none)')
  console.log('meta    :', `${meta.source} · asOf ${meta.asOf ?? '(null)'} · ${meta.retrievedAt}`)
}

async function main(): Promise<void> {
  let payload: unknown
  let usedHttp = true
  try {
    payload = await getViaHttp()
  } catch (e: unknown) {
    console.warn('HTTP path failed:', e instanceof Error ? e.message : e)
    usedHttp = false
    payload = await getViaDirect()
  }

  console.log('\n── full GET JSON ──')
  console.log(JSON.stringify(payload, null, 2))
  summarize(payload)

  const question = '폐형광등 어디에 버려요?'
  let askPayload: unknown
  try {
    askPayload = usedHttp ? await askViaHttp(question) : await askViaDirect(question)
  } catch (e: unknown) {
    console.warn('ask HTTP path failed:', e instanceof Error ? e.message : e)
    askPayload = await askViaDirect(question)
  }
  summarizeAsk(askPayload)
}

main().catch((e) => { console.error(e); process.exit(1) })
