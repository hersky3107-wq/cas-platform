'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/db/supabase'

export default function MePage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    async function getUser() {
      const { data } = await supabase.auth.getUser()
      setEmail(data.user?.email ?? null)
    }

    getUser()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>내 로그인 상태</h1>
      <p>{email ? `로그인됨: ${email}` : '로그인 안 됨'}</p>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="mt-4 text-sm text-red-400 hover:text-red-300"
      >
        Sign out
      </button>
    </main>
  )
}