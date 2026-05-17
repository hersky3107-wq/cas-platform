import { getClientAccessToken } from '@/lib/db/auth-client'

type FetchInit = RequestInit & { json?: unknown }

/**
 * Same-origin API fetch with session cookies and Bearer token.
 * Server routes validate via resolveRouteAuth (cookies or Authorization header).
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: FetchInit
): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.json !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const token = await getClientAccessToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const { json, body, ...rest } = init ?? {}
  const resolvedBody = json !== undefined ? JSON.stringify(json) : body

  return fetch(input, {
    ...rest,
    headers,
    body: resolvedBody,
    credentials: 'include',
  })
}
