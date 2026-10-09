const DEFAULT_TIMEOUT_MS = 20_000
const RETRY_DELAYS_MS = [0, 1000, 3000]

const lastCallAt = new Map<string, number>()

export interface PoliteFetchOptions {
  sourceKey: string
  minIntervalMs?: number
  timeoutMs?: number
  headers?: Record<string, string>
  as?: 'json' | 'text' | 'bytes'
  method?: 'GET' | 'POST'
  body?: string
}

export interface PoliteFetchResult {
  ok: boolean
  status: number
  data: unknown
  text: string
  error: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function redactSecrets(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = value
  for (const [key, secret] of Object.entries(env)) {
    if (!secret || secret.length < 8) continue
    if (!/KEY|TOKEN|PASSWORD|SECRET|MAP_KEY/i.test(key)) continue
    out = out.split(secret).join('[redacted]')
  }
  return out
}

export async function politeFetch(url: string, options: PoliteFetchOptions): Promise<PoliteFetchResult> {
  const minInterval = options.minIntervalMs ?? 1000
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const last = lastCallAt.get(options.sourceKey) ?? 0
  const wait = last + minInterval - Date.now()
  if (wait > 0) await sleep(wait)

  let lastError = 'fetch failed'
  let lastStatus = 0
  let lastText = ''

  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      lastCallAt.set(options.sourceKey, Date.now())
      const response = await fetch(url, {
        signal: controller.signal,
        method: options.method ?? 'GET',
        body: options.body,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          Accept: options.as === 'text' ? 'text/plain, application/xml, */*' : 'application/json, */*',
          'User-Agent': 'AIMANI-CrisisIngest/2B1',
          ...options.headers,
        },
      })
      lastStatus = response.status
      if (options.as === 'bytes') {
        if (response.status === 429 || response.status >= 500) {
          lastError = `HTTP ${response.status}`
          continue
        }
        if (!response.ok) {
          return { ok: false, status: response.status, data: null, text: '', error: `HTTP ${response.status}` }
        }
        const buf = await response.arrayBuffer()
        return { ok: true, status: response.status, data: buf, text: '', error: null }
      }
      lastText = await response.text()
      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`
        continue
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          data: null,
          text: lastText,
          error: `HTTP ${response.status}`,
        }
      }
      if (options.as === 'text') {
        return { ok: true, status: response.status, data: lastText, text: lastText, error: null }
      }
      try {
        return { ok: true, status: response.status, data: JSON.parse(lastText), text: lastText, error: null }
      } catch {
        return { ok: true, status: response.status, data: lastText, text: lastText, error: null }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(timer)
    }
  }

  return { ok: false, status: lastStatus, data: null, text: lastText, error: lastError }
}

export function missingEnv(names: string[], env: NodeJS.ProcessEnv): string | null {
  const missing = names.filter((name) => !env[name]?.trim())
  if (!missing.length) return null
  return `missing env ${missing.join(', ')} — source skipped`
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function isoTime(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
