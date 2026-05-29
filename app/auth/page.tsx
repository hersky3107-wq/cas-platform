'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/db/supabase'
import { getAuthCallbackUrl } from '@/lib/supabase/auth-urls'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function safeRedirectPath(path: string | null): string | null {
  if (!path) return null
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return null
  }
  return path
}

function AuthForm() {
  const searchParams = useSearchParams()
  const errorFromUrl = searchParams.get('error')
  const returnPath = safeRedirectPath(searchParams.get('redirectTo'))

  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(errorFromUrl ?? '')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)

  const authCallbackBase = getAuthCallbackUrl(
    typeof window !== 'undefined' ? window.location.origin : undefined
  )
  const redirectTo = returnPath
    ? `${authCallbackBase}?redirectTo=${encodeURIComponent(returnPath)}`
    : authCallbackBase

  async function handleGoogleLogin() {
    setMessage('')
    setGoogleLoading(true)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    })

    if (error) {
      setMessage(error.message)
      setGoogleLoading(false)
    }
  }

  async function handleLogin() {
    if (!email.trim()) {
      setMessage('Enter your email address.')
      return
    }

    setMessage('')
    setEmailLoading(true)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    })

    setEmailLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Check your email. Open the link in this same browser to finish signing in.')
  }

  const isError = Boolean(errorFromUrl) || message.toLowerCase().includes('error')

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b1020] px-4 py-12 text-white">
      <div className="w-full max-w-md rounded-[20px] border border-white/10 bg-[#131c35] p-8 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/85">
          CAS Platform
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Continue with Google or a magic link</p>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || emailLoading}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GoogleIcon className="h-5 w-5 shrink-0" />
          {googleLoading ? 'Redirecting to Google…' : 'Sign in with Google'}
        </button>

        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">or</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <label htmlFor="auth-email" className="sr-only">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleLogin()
          }}
          disabled={googleLoading || emailLoading}
          className="w-full rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/55 focus:outline-none disabled:opacity-60"
        />

        <button
          type="button"
          onClick={handleLogin}
          disabled={googleLoading || emailLoading}
          className="mt-3 w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {emailLoading ? 'Sending…' : 'Send magic link'}
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          By signing in, you agree to our{' '}
          <a href="/terms" className="underline hover:text-slate-300">
            Terms of Service
          </a>
          {' / '}
          <a href="/privacy" className="underline hover:text-slate-300">
            Privacy Policy
          </a>
          {' / '}
          <a href="/refund" className="underline hover:text-slate-300">
            Refund Policy
          </a>
        </p>

        {message ? (
          <p
            className={`mt-4 text-sm leading-relaxed ${isError ? 'text-red-400' : 'text-slate-300'}`}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </div>
    </main>
  )
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#0b1020] text-slate-400">
          <p>Loading…</p>
        </main>
      }
    >
      <AuthForm />
    </Suspense>
  )
}
