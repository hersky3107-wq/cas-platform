/**
 * Throwaway verify — calls GET /api/domin/prices and prints:
 *   - a few items per group (name, retail, changePct, direction)
 *   - context + contextMeta
 *   - source / confidence
 *
 * Prefers a running Next.js dev server (NEXT_BASE_URL, default
 * http://localhost:3000). Falls back to calling getPrices() directly.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/verify-prices.ts
 *
 * Direct fallback (no Next server):
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/verify-prices.ts
 */

const BASE = (process.env.NEXT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

async function viaHttp(): Promise<unknown> {
  const url = `${BASE}/api/domin/prices`
  console.log(`GET ${url}`)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
    headers: { Accept: 'application/json' },
  })
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    console.log(text.slice(0, 500))
    throw new Error('Non-JSON response from route')
  }
}

async function viaDirect(): Promise<unknown> {
  console.log('(dev server unreachable — calling getPrices() directly)')
  const { getPrices } = await import('../lib/jeju/prices')
  return getPrices()
}

function dirLabel(d: 0 | 1 | null): string {
  if (d === 1) return '▲ 상승'
  if (d === 0) return '▼ 하락'
  return '─'
}

function summarize(p: unknown): void {
  if (!p || typeof p !== 'object') { console.log('Unexpected payload:', p); return }
  const data = p as Record<string, unknown>
  const groups = (data.groups ?? {}) as Record<string, unknown[]>
  const meta = (data.contextMeta ?? {}) as Record<string, unknown>

  console.log('\n── summary ──')
  console.log('ok         :', data.ok)
  console.log('source     :', data.source, '/', data.confidence)
  console.log('updated    :', data.updated)
  console.log('errors     :', data.errors)

  for (const [groupName, items] of Object.entries(groups)) {
    if (!Array.isArray(items) || items.length === 0) continue
    console.log(`\n── ${groupName} (${items.length}개) ──`)
    for (const it of items.slice(0, 6)) {
      const item = it as Record<string, unknown>
      const pct = typeof item.changePct === 'number' ? `${item.changePct > 0 ? '+' : ''}${item.changePct}%` : '─'
      console.log(
        `  ${String(item.itemName).padEnd(20)} ${String(item.cls ?? '').padEnd(6)} ` +
        `${item.retailPrice != null ? `${item.retailPrice.toLocaleString('ko-KR')}원` : '─'.padEnd(8)} ` +
        `${dirLabel(item.direction as 0 | 1 | null)}  ${pct}  단위:${item.unit}`
      )
    }
    if (items.length > 6) console.log(`  … 외 ${items.length - 6}개`)
  }

  console.log('\n── context ──')
  console.log(data.context || '(empty)')
  console.log('\n── contextMeta ──')
  console.log('source      :', meta.source)
  console.log('retrievedAt :', meta.retrievedAt)
  console.log('asOf        :', meta.asOf ?? '(null)')
  console.log('\nfreshness  :', data.freshnessNote)
  console.log('updatedAt  :', data.updatedAt)
}

async function main(): Promise<void> {
  let payload: unknown
  try {
    payload = await viaHttp()
  } catch (e: unknown) {
    console.warn('HTTP path failed:', e instanceof Error ? e.message : e)
    payload = await viaDirect()
  }

  console.log('\n── full JSON ──')
  console.log(JSON.stringify(payload, null, 2))
  summarize(payload)
}

main().catch((e) => { console.error(e); process.exit(1) })
