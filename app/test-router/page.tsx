'use client'

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/db/supabase'

type ProviderName = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'mistral'

type RouterResult = {
  provider: ProviderName
  model: string
  text: string | null
  responseTimeMs: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  error?: string
}

export default function TestRouterPage() {
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.')
  const [selected, setSelected] = useState<Record<ProviderName, boolean>>({
    openai: true,
    anthropic: true,
    google: false,
    xai: false,
    deepseek: false,
    mistral: false,
  })
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [results, setResults] = useState<RouterResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const providers = useMemo(
    () => (Object.keys(selected) as ProviderName[]).filter((p) => selected[p]),
    [selected]
  )

  async function onSubmit() {
    setError(null)
    setResults(null)
    setSessionId(null)
    setLoading(true)

    try {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token

      const res = await fetch('/api/ai-router', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          systemPrompt,
          providers,
          supabaseAccessToken: accessToken ?? undefined,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Request failed')
        return
      }

      setSessionId(json?.sessionId ?? null)
      setResults(Array.isArray(json?.results) ? (json.results as RouterResult[]) : [])
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>AI Router Test</h1>

      <div style={{ display: 'grid', gap: 10, maxWidth: 900 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>System prompt</div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Prompt</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Ask something..."
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {(Object.keys(selected) as ProviderName[]).map((p) => (
            <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={selected[p]}
                onChange={(e) => setSelected((s) => ({ ...s, [p]: e.target.checked }))}
              />
              <span>{p}</span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={onSubmit}
            disabled={loading || !prompt.trim() || providers.length === 0}
            style={{ padding: '10px 14px' }}
          >
            {loading ? 'Routing…' : 'Submit'}
          </button>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Providers: {providers.length ? providers.join(', ') : '(none selected)'}
            {sessionId ? ` • session_id: ${sessionId}` : null}
          </div>
        </div>

        {error ? (
          <div style={{ padding: 12, background: '#fee', color: '#700' }}>{error}</div>
        ) : null}
      </div>

      {results ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
            {results.map((r) => (
              <section
                key={r.provider}
                style={{
                  flex: 1,
                  minWidth: 240,
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 600 }}>{r.provider}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{r.responseTimeMs}ms</div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  model: {r.model}
                </div>

                {r.error ? (
                  <pre
                    style={{
                      marginTop: 10,
                      whiteSpace: 'pre-wrap',
                      background: '#fff5f5',
                      color: '#700',
                      padding: 10,
                      borderRadius: 6,
                    }}
                  >
                    {r.error}
                  </pre>
                ) : null}

                <pre
                  style={{
                    marginTop: 10,
                    whiteSpace: 'pre-wrap',
                    background: '#f7f7f7',
                    padding: 10,
                    borderRadius: 6,
                    minHeight: 120,
                  }}
                >
                  {r.text ?? '(no text)'}
                </pre>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  )
}

