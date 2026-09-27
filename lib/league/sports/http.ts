const FETCH_TIMEOUT_MS = 20_000
const UA = 'cas-platform-league-sports/1.0'

export async function fetchText(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; text: string; headers: Headers; status: number } | { ok: false; error: string; status: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 180)}`, status: res.status }
    return { ok: true, text, headers: res.headers, status: res.status }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: msg.toLowerCase().includes('abort') ? `timeout after ${FETCH_TIMEOUT_MS}ms` : msg,
      status: 0,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; json: unknown; headers: Headers; status: number } | { ok: false; error: string; status: number }> {
  const r = await fetchText(url, init, fetchImpl)
  if (!r.ok) return r
  try {
    return { ok: true, json: JSON.parse(r.text) as unknown, headers: r.headers, status: r.status }
  } catch {
    return { ok: false, error: `Non-JSON: ${r.text.slice(0, 120)}`, status: r.status }
  }
}
