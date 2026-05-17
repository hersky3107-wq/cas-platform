'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/db/supabase'
import { getAuthCallbackUrl } from '@/lib/supabase/auth-urls'

function AuthForm() {
  const searchParams = useSearchParams()
  const errorFromUrl = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(errorFromUrl ?? '')

  async function handleLogin() {
    setMessage('Sending login email…')

    const emailRedirectTo = getAuthCallbackUrl(
      typeof window !== 'undefined' ? window.location.origin : undefined
    )

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
      },
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Check your email. Open the link in this same browser to finish signing in.')
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>CAS Login</h1>

      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          display: 'block',
          width: 300,
          padding: 10,
          marginTop: 20,
          marginBottom: 10,
        }}
      />

      <button type="button" onClick={handleLogin}>
        Send magic link
      </button>

      {message ? (
        <p style={{ marginTop: 16, maxWidth: 420, color: errorFromUrl ? '#f87171' : undefined }}>
          {message}
        </p>
      ) : null}
    </main>
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}><p>Loading…</p></main>}>
      <AuthForm />
    </Suspense>
  )
}
