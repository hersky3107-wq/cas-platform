'use client'

import { useState } from 'react'
import { supabase } from '@/lib/db/supabase'

export default function ApiKeysPage() {
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')

  async function handleSave() {
    setMessage('저장 중...')

    const { data } = await supabase.auth.getUser()
    const user = data.user

    if (!user) {
      setMessage('로그인이 필요합니다.')
      return
    }

    const res = await fetch('/api/user-api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        provider,
        api_key: apiKey
      })
    })

    let result = null

    try {
      result = await res.json()
    } catch (e) {
      result = { error: '서버 응답 없음' }
    }

    if (!res.ok) {
      setMessage(result.error)
      return
    }

    setApiKey('')
    setMessage('API 키가 암호화되어 저장되었습니다.')
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>API 키 설정</h1>

      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10 }}
      >
        <option value="openai">OpenAI</option>
        <option value="anthropic">Claude</option>
        <option value="google">Gemini</option>
        <option value="xai">Grok</option>
        <option value="deepseek">DeepSeek</option>
        <option value="mistral">Mistral</option>
      </select>

      <input
        type="password"
        placeholder="API 키 입력"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        style={{
          display: 'block',
          width: 400,
          padding: 10,
          marginBottom: 10
        }}
      />

      <button onClick={handleSave}>저장</button>

      <p>{message}</p>
    </main>
  )
}