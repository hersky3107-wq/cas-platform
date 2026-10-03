import 'server-only'

/**
 * In-memory KRX data.krx.co.kr login session (pykrx 1.2.9 port).
 * Never log KRX_ID, passwords, or cookies.
 */

export const KRX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const KRX_LOGIN_PAGE = 'https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001.cmd'
export const KRX_LOGIN_JSP = 'https://data.krx.co.kr/contents/MDC/COMS/client/view/login.jsp?site=mdc'
export const KRX_LOGIN_URL = 'https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001D1.cmd'
export const KRX_JSON_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'
export const KRX_STATS_REFERER = 'https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd'
export const KRX_MIN_REQUEST_GAP_MS = 1500
export const KRX_SESSION_TTL_MS = 3_600_000
export const KRX_SESSION_REFRESH_BUFFER_MS = 300_000
export const KRX_REQUEST_TIMEOUT_MS = 15_000

export type KrxSessionFailReason =
  | 'missing_credentials'
  | 'password_change_required'
  | 'login_failed'
  | 'http_error'
  | 'auth_expired'

export type KrxSessionOk<T> = { ok: true; value: T }
export type KrxSessionErr = { ok: false; reason: KrxSessionFailReason }
export type KrxSessionResult<T> = KrxSessionOk<T> | KrxSessionErr

export type KrxCookieJar = Map<string, string>

export type KrxSessionDeps = {
  fetch: typeof fetch
  now: () => number
  sleep: (ms: number) => Promise<void>
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  getCredentials: () => { id: string; pw: string } | null
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function defaultLog(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[krx-session] ${message}`
  if (level === 'warn') console.warn(line)
  else if (level === 'error') console.error(line)
  else console.info(line)
}

function defaultCredentials(): { id: string; pw: string } | null {
  const id = process.env.KRX_ID?.trim() ?? ''
  const pw = process.env.KRX_PW?.trim() ?? ''
  if (!id || !pw) return null
  return { id, pw }
}

export function applySetCookie(jar: KrxCookieJar, setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    const first = header.split(';')[0] ?? ''
    const eq = first.indexOf('=')
    if (eq <= 0) continue
    const name = first.slice(0, eq).trim()
    const value = first.slice(eq + 1).trim()
    if (!name) continue
    jar.set(name, value)
  }
}

export function cookieHeader(jar: KrxCookieJar): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

export function readSetCookies(headers: Headers): string[] {
  const withSet = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withSet.getSetCookie === 'function') {
    try {
      return withSet.getSetCookie()
    } catch {
      // fall through
    }
  }
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

export function parseLoginErrorCode(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const rec = json as Record<string, unknown>
  return String(rec._error_code ?? rec.error_code ?? '')
}

export function looksLikeAuthFailure(http: number, body: string): boolean {
  if (http === 401 || http === 403) return true
  const lower = body.slice(0, 2000).toLowerCase()
  return lower.includes('login.jsp') || (lower.includes('mdccoms001') && lower.includes('login'))
}

type SessionState = {
  jar: KrxCookieJar
  authenticatedUntil: number
  lastRequestAt: number
  requestCount: number
  loggedLoginFailure: boolean
  fatal: KrxSessionFailReason | null
}

function emptyState(): SessionState {
  return {
    jar: new Map(),
    authenticatedUntil: 0,
    lastRequestAt: 0,
    requestCount: 0,
    loggedLoginFailure: false,
    fatal: null,
  }
}

export function createKrxSession(overrides: Partial<KrxSessionDeps> = {}) {
  const deps: KrxSessionDeps = {
    fetch: overrides.fetch ?? fetch,
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? defaultSleep,
    log: overrides.log ?? defaultLog,
    getCredentials: overrides.getCredentials ?? defaultCredentials,
  }
  const state = emptyState()

  const failOnce = (reason: KrxSessionFailReason, message: string): KrxSessionErr => {
    if (!state.loggedLoginFailure) {
      state.loggedLoginFailure = true
      deps.log(reason === 'password_change_required' ? 'error' : 'error', message)
    }
    return { ok: false, reason }
  }

  const throttle = async (): Promise<void> => {
    const now = deps.now()
    const elapsed = now - state.lastRequestAt
    if (state.lastRequestAt > 0 && elapsed < KRX_MIN_REQUEST_GAP_MS) {
      await deps.sleep(KRX_MIN_REQUEST_GAP_MS - elapsed)
    }
    state.lastRequestAt = deps.now()
    state.requestCount += 1
  }

  const request = async (
    url: string,
    init: RequestInit,
  ): Promise<{ http: number; body: string; headers: Headers }> => {
    await throttle()
    const headers = new Headers(init.headers)
    headers.set('User-Agent', KRX_USER_AGENT)
    const cookie = cookieHeader(state.jar)
    if (cookie) headers.set('Cookie', cookie)
    let res: Response
    try {
      res = await deps.fetch(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(KRX_REQUEST_TIMEOUT_MS),
      })
    } catch {
      return { http: 0, body: '', headers: new Headers() }
    }
    applySetCookie(state.jar, readSetCookies(res.headers))
    const body = await res.text().catch(() => '')
    return { http: res.status, body, headers: res.headers }
  }

  const postLogin = async (skipDup: boolean): Promise<{ http: number; json: unknown; body: string }> => {
    const creds = deps.getCredentials()
    if (!creds) {
      return { http: 0, json: null, body: '' }
    }
    const payload = new URLSearchParams({
      mbrNm: '',
      telNo: '',
      di: '',
      certType: '',
      mbrId: creds.id,
      pw: creds.pw,
    })
    if (skipDup) payload.set('skipDup', 'Y')
    const { http, body } = await request(KRX_LOGIN_URL, {
      method: 'POST',
      headers: {
        Referer: KRX_LOGIN_PAGE,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    })
    let json: unknown = null
    try {
      json = body ? JSON.parse(body) : null
    } catch {
      json = null
    }
    return { http, json, body }
  }

  const login = async (): Promise<KrxSessionResult<void>> => {
    if (state.fatal === 'password_change_required') {
      return { ok: false, reason: 'password_change_required' }
    }
    const creds = deps.getCredentials()
    if (!creds) {
      return failOnce('missing_credentials', 'KRX login failed: credentials not set')
    }
    state.jar = new Map()
    state.authenticatedUntil = 0
    const warmup1 = await request(KRX_LOGIN_PAGE, { method: 'GET' })
    if (warmup1.http === 0) return failOnce('http_error', 'KRX login failed')
    const warmup2 = await request(KRX_LOGIN_JSP, {
      method: 'GET',
      headers: { Referer: KRX_LOGIN_PAGE },
    })
    if (warmup2.http === 0) return failOnce('http_error', 'KRX login failed')

    let posted = await postLogin(false)
    if (posted.http === 0) return failOnce('http_error', 'KRX login failed')
    let code = parseLoginErrorCode(posted.json)

    if (code === 'CD010') {
      state.fatal = 'password_change_required'
      return failOnce('password_change_required', 'KRX login failed: password change required')
    }

    if (code === 'CD011') {
      deps.log('warn', 'KRX duplicate session replaced')
      posted = await postLogin(true)
      if (posted.http === 0) return failOnce('http_error', 'KRX login failed')
      code = parseLoginErrorCode(posted.json)
      if (code === 'CD010') {
        state.fatal = 'password_change_required'
        return failOnce('password_change_required', 'KRX login failed: password change required')
      }
    }

    if (code !== 'CD001') {
      return failOnce('login_failed', 'KRX login failed')
    }
    state.authenticatedUntil = deps.now() + KRX_SESSION_TTL_MS
    state.loggedLoginFailure = false
    return { ok: true, value: undefined }
  }

  const ensureLoggedIn = async (): Promise<KrxSessionResult<void>> => {
    const validUntil = state.authenticatedUntil - KRX_SESSION_REFRESH_BUFFER_MS
    if (state.authenticatedUntil > 0 && deps.now() < validUntil) {
      return { ok: true, value: undefined }
    }
    return login()
  }

  const jsonPost = async (
    params: Record<string, string>,
  ): Promise<KrxSessionResult<unknown>> => {
    if (state.fatal === 'password_change_required') {
      return { ok: false, reason: 'password_change_required' }
    }
    const ready = await ensureLoggedIn()
    if (!ready.ok) return ready

    const once = async (): Promise<{ http: number; body: string }> => {
      const body = new URLSearchParams(params)
      return request(KRX_JSON_URL, {
        method: 'POST',
        headers: {
          Referer: KRX_STATS_REFERER,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })
    }

    let posted = await once()
    if (posted.http === 0) return { ok: false, reason: 'http_error' }
    if (looksLikeAuthFailure(posted.http, posted.body)) {
      const relogin = await login()
      if (!relogin.ok) {
        return relogin.reason === 'password_change_required'
          ? relogin
          : { ok: false, reason: 'auth_expired' }
      }
      posted = await once()
      if (posted.http === 0) return { ok: false, reason: 'http_error' }
      if (looksLikeAuthFailure(posted.http, posted.body)) {
        return { ok: false, reason: 'auth_expired' }
      }
    }
    let json: unknown = null
    try {
      json = posted.body ? JSON.parse(posted.body) : null
    } catch {
      json = null
    }
    return { ok: true, value: json }
  }

  return {
    login,
    jsonPost,
    ensureLoggedIn,
    getRequestCount: () => state.requestCount,
    getCookieHeader: () => cookieHeader(state.jar),
    isAuthenticated: () =>
      state.authenticatedUntil > 0 && deps.now() < state.authenticatedUntil - KRX_SESSION_REFRESH_BUFFER_MS,
  }
}

export type KrxSession = ReturnType<typeof createKrxSession>

let defaultSession: KrxSession | null = null

export function getKrxSession(): KrxSession {
  if (!defaultSession) defaultSession = createKrxSession()
  return defaultSession
}

export function resetKrxSession(): void {
  defaultSession = null
}

export function setKrxSession(session: KrxSession): void {
  defaultSession = session
}
