import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  applySetCookie,
  cookieHeader,
  createKrxSession,
  KRX_JSON_URL,
  KRX_LOGIN_PAGE,
  KRX_LOGIN_URL,
  KRX_MIN_REQUEST_GAP_MS,
  looksLikeAuthFailure,
  parseLoginErrorCode,
} from '../krx-session'

const SECRET_ID = 'krx-user-should-never-appear'
const SECRET_PW = 'krx-pw-should-never-appear'
const SECRET_COOKIE = 'JSESSIONID=secret-cookie-value'

function fakeResponse(
  body: string,
  opts?: { status?: number; cookies?: string[] },
): Response {
  const cookieList = opts?.cookies ?? []
  return {
    status: opts?.status ?? 200,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'set-cookie') return cookieList[0] ?? null
        return null
      },
      getSetCookie: () => cookieList,
    },
    text: async () => body,
  } as unknown as Response
}

function jsonResponse(obj: unknown, opts?: { status?: number; cookies?: string[] }): Response {
  return fakeResponse(JSON.stringify(obj), opts)
}

function htmlResponse(body: string, opts?: { status?: number; cookies?: string[] }): Response {
  return fakeResponse(body, opts)
}

function formOf(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ''))
}

describe('cookie helpers', () => {
  it('stores Set-Cookie name/value and serializes Cookie header', () => {
    const jar = new Map<string, string>()
    applySetCookie(jar, [`${SECRET_COOKIE}; Path=/; HttpOnly`, 'other=1'])
    expect(cookieHeader(jar)).toBe(`${SECRET_COOKIE}; other=1`)
  })
})

describe('createKrxSession login', () => {
  it('warms up, posts form fields, keeps cookies, succeeds on CD001', async () => {
    const logs: string[] = []
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const session = createKrxSession({
      getCredentials: () => ({ id: SECRET_ID, pw: SECRET_PW }),
      log: (_level, message) => logs.push(message),
      sleep: async () => {},
      now: () => 1_000_000,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init })
        if (String(url) === KRX_LOGIN_PAGE) {
          return htmlResponse('ok', { cookies: [SECRET_COOKIE] })
        }
        if (String(url).includes('login.jsp')) return htmlResponse('login')
        return jsonResponse({ _error_code: 'CD001' })
      },
    })
    await expect(session.login()).resolves.toEqual({ ok: true, value: undefined })
    expect(calls[0]?.url).toBe(KRX_LOGIN_PAGE)
    expect(String(calls[1]?.url)).toContain('login.jsp')
    expect(calls[2]?.url).toBe(KRX_LOGIN_URL)
    const form = formOf(calls[2]?.init)
    expect(form.get('mbrId')).toBe(SECRET_ID)
    expect(form.get('pw')).toBe(SECRET_PW)
    expect(form.get('mbrNm')).toBe('')
    expect(form.get('skipDup')).toBeNull()
    expect(session.getCookieHeader()).toContain('secret-cookie-value')
    expect(logs.join('\n')).not.toContain(SECRET_ID)
    expect(logs.join('\n')).not.toContain(SECRET_PW)
    expect(logs.join('\n')).not.toContain('secret-cookie-value')
  })

  it('on CD011 retries with skipDup=Y and warns once', async () => {
    const logs: Array<{ level: string; message: string }> = []
    let loginPosts = 0
    const session = createKrxSession({
      getCredentials: () => ({ id: SECRET_ID, pw: SECRET_PW }),
      log: (level, message) => logs.push({ level, message }),
      sleep: async () => {},
      now: () => 1_000_000,
      fetch: async (url, init) => {
        if (String(url) !== KRX_LOGIN_URL) return htmlResponse('ok', { cookies: [SECRET_COOKIE] })
        loginPosts += 1
        const form = formOf(init)
        if (form.get('skipDup') === 'Y') return jsonResponse({ _error_code: 'CD001' })
        return jsonResponse({ _error_code: 'CD011' })
      },
    })
    await expect(session.login()).resolves.toMatchObject({ ok: true })
    expect(loginPosts).toBe(2)
    expect(logs.some((l) => l.level === 'warn' && l.message === 'KRX duplicate session replaced')).toBe(
      true,
    )
    expect(logs.map((l) => l.message).join('\n')).not.toContain(SECRET_ID)
  })

  it('on CD010 stops with password_change_required and does not skipDup', async () => {
    const urls: string[] = []
    const session = createKrxSession({
      getCredentials: () => ({ id: SECRET_ID, pw: SECRET_PW }),
      log: () => {},
      sleep: async () => {},
      now: () => 1_000_000,
      fetch: async (url) => {
        urls.push(String(url))
        if (String(url) === KRX_LOGIN_URL) return jsonResponse({ _error_code: 'CD010' })
        return htmlResponse('ok')
      },
    })
    await expect(session.login()).resolves.toEqual({ ok: false, reason: 'password_change_required' })
    expect(urls.filter((u) => u === KRX_LOGIN_URL)).toHaveLength(1)
    const json = await session.jsonPost({ bld: 'dbms/MDC/STAT/standard/MDCSTAT02401' })
    expect(json).toEqual({ ok: false, reason: 'password_change_required' })
    expect(urls.filter((u) => u === KRX_JSON_URL)).toHaveLength(0)
  })

  it('returns missing_credentials without calling the network', async () => {
    let fetches = 0
    const session = createKrxSession({
      getCredentials: () => null,
      log: () => {},
      sleep: async () => {},
      fetch: async () => {
        fetches += 1
        return htmlResponse('no')
      },
    })
    await expect(session.login()).resolves.toEqual({ ok: false, reason: 'missing_credentials' })
    expect(fetches).toBe(0)
  })

  it('re-logins once on 401 then retries the JSON post', async () => {
    let jsonTries = 0
    let logins = 0
    const session = createKrxSession({
      getCredentials: () => ({ id: SECRET_ID, pw: SECRET_PW }),
      log: () => {},
      sleep: async () => {},
      now: () => 1_000_000,
      fetch: async (url) => {
        const u = String(url)
        if (u === KRX_LOGIN_URL) {
          logins += 1
          return jsonResponse({ _error_code: 'CD001' }, { cookies: [SECRET_COOKIE] })
        }
        if (u === KRX_JSON_URL) {
          jsonTries += 1
          if (jsonTries === 1) return htmlResponse('<html>login.jsp</html>', { status: 401 })
          return jsonResponse({ output: [{ ISU_SRT_CD: '005930' }] })
        }
        return htmlResponse('ok')
      },
    })
    const posted = await session.jsonPost({ bld: 'dbms/MDC/STAT/standard/MDCSTAT02401' })
    expect(posted.ok).toBe(true)
    expect(jsonTries).toBe(2)
    expect(logins).toBe(2)
  })

  it('spaces sequential requests by at least 1500 ms', async () => {
    const sleeps: number[] = []
    let now = 50_000
    const session = createKrxSession({
      getCredentials: () => ({ id: SECRET_ID, pw: SECRET_PW }),
      log: () => {},
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms)
        now += ms
      },
      fetch: async (url) => {
        if (String(url) === KRX_LOGIN_URL) return jsonResponse({ _error_code: 'CD001' })
        if (String(url) === KRX_JSON_URL) return jsonResponse({ output: [] })
        return htmlResponse('ok')
      },
    })
    await session.login()
    sleeps.length = 0
    await session.jsonPost({ bld: 'x' })
    await session.jsonPost({ bld: 'y' })
    expect(sleeps.length).toBeGreaterThan(0)
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(KRX_MIN_REQUEST_GAP_MS)
  })
})

describe('login JSON helpers', () => {
  it('reads _error_code and treats 401/login.jsp as auth failure', () => {
    expect(parseLoginErrorCode({ _error_code: 'CD001' })).toBe('CD001')
    expect(looksLikeAuthFailure(401, '')).toBe(true)
    expect(looksLikeAuthFailure(200, '<html>login.jsp</html>')).toBe(true)
    expect(looksLikeAuthFailure(200, '{"output":[]}')).toBe(false)
  })
})
