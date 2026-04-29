'use client'

import { useState } from 'react'
import { supabase } from '@/lib/db/supabase'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  async function handleLogin() {
    setMessage('로그인 메일 보내는 중...')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: 'http://localhost:3000'
      }
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('이메일을 확인하세요. 로그인 링크가 발송되었습니다.')
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>CAS 로그인</h1>

      <input
        type="email"
        placeholder="이메일 입력"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          display: 'block',
          width: 300,
          padding: 10,
          marginTop: 20,
          marginBottom: 10
        }}
      />

      <button onClick={handleLogin}>
        이메일 로그인 링크 받기
      </button>

      <p>{message}</p>
    </main>
  )
}