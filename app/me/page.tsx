'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/db/supabase'

export default function MePage() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    async function getUser() {
      const { data } = await supabase.auth.getUser()
      setEmail(data.user?.email ?? null)
    }

    getUser()
  }, [])

  return (
    <main style={{ padding: 40 }}>
      <h1>내 로그인 상태</h1>
      <p>{email ? `로그인됨: ${email}` : '로그인 안 됨'}</p>
    </main>
  )
}