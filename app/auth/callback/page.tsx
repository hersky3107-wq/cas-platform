'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/db/supabase'
import { finishAuthCallback, parseAuthCallbackParams } from '@/lib/supabase/finish-auth'
import { getSiteUrl } from '@/lib/supabase/site-url'

function AuthCallbackClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Completing sign in…')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const params = parseAuthCallbackParams(
        searchParams,
        typeof window !== 'undefined' ? window.location.hash : ''
      )

      const result = await finishAuthCallback(supabase, params, window.location.hash)

      if (cancelled) return

      if (!result.ok) {
        setStatus(result.message)
        router.replace(`/auth?error=${encodeURIComponent(result.message)}`)
        return
      }

      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }

      setStatus('Signed in. Redirecting…')
      router.replace(`${getSiteUrl(window.location.origin)}/`)
      router.refresh()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, searchParams])

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
