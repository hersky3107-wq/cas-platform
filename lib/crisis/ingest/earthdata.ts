import { asArray, asRecord, politeFetch } from './fetch'

export const EARTHDATA_TOKEN_URL = 'https://urs.earthdata.nasa.gov/api/users/find_or_create_token'

export function looksLikeJwt(value: string): boolean {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)
}

/**
 * Earthdata Login bearer token. EARTHDATA_TOKEN wins. A JWT stored in
 * EARTHDATA_PASSWORD is used as the token. Otherwise username + password
 * are exchanged for a token (Basic auth).
 */
export async function earthdataBearer(env: NodeJS.ProcessEnv): Promise<{
  token: string | null
  via: string
  httpCalls: number
  error?: string
}> {
  const direct = env.EARTHDATA_TOKEN?.trim()
  if (direct) return { token: direct, via: 'EARTHDATA_TOKEN', httpCalls: 0 }
  const user = env.EARTHDATA_USERNAME?.trim() ?? ''
  const pass = env.EARTHDATA_PASSWORD?.trim() ?? ''
  if (looksLikeJwt(pass)) return { token: pass, via: 'EARTHDATA_PASSWORD holds a token', httpCalls: 0 }
  if (!user || !pass) return { token: null, via: 'none', httpCalls: 0, error: 'missing EARTHDATA_TOKEN or EARTHDATA_USERNAME/EARTHDATA_PASSWORD' }
  const res = await politeFetch(EARTHDATA_TOKEN_URL, {
    sourceKey: 'earthdata_login',
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` },
  })
  if (!res.ok) return { token: null, via: 'basic', httpCalls: 1, error: `earthdata token HTTP ${res.status}` }
  const record = asRecord(res.data)
  const token = typeof record?.access_token === 'string' ? record.access_token : null
  if (token) return { token, via: 'basic', httpCalls: 1 }
  const first = asRecord(asArray(res.data)[0])
  return {
    token: typeof first?.access_token === 'string' ? first.access_token : null,
    via: 'basic',
    httpCalls: 1,
    error: 'earthdata token response had no access_token',
  }
}
