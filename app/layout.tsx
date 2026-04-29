'use client'

import './globals.css'
import { useEffect } from 'react'
import { supabase } from '@/lib/db/supabase'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    supabase.auth.getSession()
  }, [])

  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}