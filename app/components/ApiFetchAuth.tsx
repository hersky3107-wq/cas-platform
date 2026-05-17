'use client'

import { useEffect } from 'react'
import { getClientAccessToken } from '@/lib/db/auth-client'

/**
 * Patches window.fetch for same-origin /api/* calls so every mode sends
 * cookies + Bearer token (fixes "Invalid session" on production).
 */
export function ApiFetchAuth() {
  useEffect(() => {
    const original = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url

      const isSameOriginApi =
        url.startsWith('/api/') ||
        (typeof window !== 'undefined' && url.includes(`${window.location.origin}/api/`))

      if (!isSameOriginApi) {
        return original(input, init)
      }

      const headers = new Headers(init?.headers)
      if (!headers.has('Authorization')) {
        const token = await getClientAccessToken()
        if (token) {
          headers.set('Authorization', `Bearer ${token}`)
        }
      }

      return original(input, {
        ...init,
        headers,
        credentials: init?.credentials ?? 'include',
      })
    }

    return () => {
      window.fetch = original
    }
  }, [])

  return null
}
