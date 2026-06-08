'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { supabase } from '@/lib/db/supabase'
import { finishAuthCallback, parseAuthCallbackParams } from '@/lib/supabase/finish-auth'

function safeRedirectPath(path: string | null): string | null {
  if (!path) return null
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return null
  }
  return path
}

function AuthCallbackClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Completing sign in…')
  const returnPath = safeRedirectPath(searchParams.get('redirectTo')) ?? '/'

  useEffect(() => {
    let cancelled = false

    async function run() {
      const params = parseAuthCallbackParams(
        searchParams,
        typeof window !== 'undefined' ? window.location.hash : ''
      )

      let session = (await supabase.auth.getSession()).data.session

      if (!session) {
        const result = await finishAuthCallback(supabase, params, window.location.hash)
        if (cancelled) return
        session = (await supabase.auth.getSession()).data.session
        if (!session) {
          const message = result.ok
            ? 'Sign-in completed but no session was found. Please try again.'
            : result.message
          setStatus(message)
          router.replace(`/auth?error=${encodeURIComponent(message)}`)
          return
        }
      }

      if (cancelled) return

      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }

      await authenticatedFetch('/api/auth/welcome-credits', {
        method: 'POST',
        json: {},
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }).catch((err) => console.error('[welcome-credits]', err))

      setStatus('Signed in. Redirecting…')
      router.replace(returnPath)
      router.refresh()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, searchParams, returnPath])

  return (
    <main style={{ padding: 40 }}>
      <p>{status}</p>
    </main>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}><p>Completing sign in…</p></main>}>
      <AuthCallbackClient />
    </Suspense>
  )
}
