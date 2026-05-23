'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { SubscriptionSection } from '@/components/settings/SubscriptionSection'
import { supabase } from '@/lib/db/supabase'

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
  { id: 'xai', label: 'xAI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'mistral', label: 'Mistral' },
] as const

type ProviderId = (typeof PROVIDERS)[number]['id']

export default function SettingsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [keys, setKeys] = useState<Record<ProviderId, string>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.id, ''])) as Record<ProviderId, string>
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function syncAuth() {
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      const u = data.user
      setUserId(u?.id ?? null)
      setEmail(u?.email ?? null)
      setAuthLoading(false)
    }

    syncAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      setUserId(u?.id ?? null)
      setEmail(u?.email ?? null)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const updateKey = useCallback((id: ProviderId, value: string) => {
    setKeys((prev) => ({ ...prev, [id]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    setMessage(null)

    if (!userId) {
      setMessage({ type: 'err', text: 'You must be signed in to save API keys.' })
      return
    }

    setSaving(true)
    try {
      const { error: delErr } = await supabase
        .from('user_api_keys')
        .delete()
        .eq('user_id', userId)

      if (delErr) {
        setMessage({
          type: 'err',
          text: `Could not clear existing keys: ${delErr.message}`,
        })
        return
      }

      const toSave = PROVIDERS.map((p) => ({
        provider: p.id,
        value: keys[p.id].trim(),
      })).filter((x) => x.value.length > 0)

      for (const { provider, value } of toSave) {
        const res = await fetch('/api/user-api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            provider,
            api_key: value,
          }),
        })

        let body: { error?: string; ok?: boolean } = {}
        try {
          body = await res.json()
        } catch {
          body = { error: 'Invalid server response' }
        }

        if (!res.ok) {
          setMessage({
            type: 'err',
            text: body.error ?? `Failed to save ${provider}`,
          })
          return
        }
      }

      setMessage({
        type: 'ok',
        text:
          toSave.length === 0
            ? 'All keys cleared. No new keys were saved.'
            : `Saved ${toSave.length} key(s) successfully.`,
      })
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Something went wrong.',
      })
    } finally {
      setSaving(false)
    }
  }, [userId, keys])

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight text-white">
            API keys
          </h1>
          <Link
            href="/"
            className="text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
          >
            Home
          </Link>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-xl">
          {authLoading ? (
            <p className="text-sm text-zinc-400">Checking session…</p>
          ) : userId ? (
            <p className="text-sm text-zinc-300">
              Signed in as{' '}
              <span className="font-medium text-white">{email ?? userId}</span>
            </p>
          ) : (
            <p className="text-sm text-amber-200/90">
              You are not signed in. Sign in elsewhere, then return to this page.
            </p>
          )}

          <div className="mt-6 space-y-4">
            {PROVIDERS.map((p) => (
              <label key={p.id} className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {p.label}
                </span>
                <input
                  type="password"
                  name={p.id}
                  autoComplete="off"
                  value={keys[p.id]}
                  onChange={(e) => updateKey(p.id, e.target.value)}
                  disabled={!userId || saving}
                  placeholder={`${p.label} API key`}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none ring-emerald-500/40 focus:border-emerald-600/60 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!userId || saving}
            className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save keys'}
          </button>

          {message ? (
            <p
              className={`mt-4 text-sm ${
                message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'
              }`}
              role="status"
            >
              {message.text}
            </p>
          ) : null}

          <p className="mt-6 text-xs leading-relaxed text-zinc-500">
            Keys are sent to the server over HTTPS, encrypted, and stored securely. Saving
            replaces all previously stored keys for your account with the values you enter
            above (empty fields are not stored).
          </p>
        </div>

        <SubscriptionSection userId={userId} authLoading={authLoading} />
      </div>
    </main>
  )
}
