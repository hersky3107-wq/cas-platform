'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export function AdminNav() {
  const [pending, setPending] = useState<number | null>(null)
  const [blackouts, setBlackouts] = useState<number>(0)
  const [switchOn, setSwitchOn] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/league/grade/count', { credentials: 'include' })
        const body = (await res.json().catch(() => null)) as { pendingCount?: number }
        if (res.ok && typeof body?.pendingCount === 'number') setPending(body.pendingCount)
      } catch {
        setPending(null)
      }
      try {
        const res = await fetch('/api/admin/league/blackout', { credentials: 'include' })
        const body = (await res.json().catch(() => null)) as { count?: number; switch?: { on?: boolean } }
        if (res.ok && typeof body?.count === 'number') setBlackouts(body.count)
        if (res.ok) setSwitchOn(Boolean(body.switch?.on))
      } catch {
        setBlackouts(0)
      }
    })()
  }, [])

  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm">
      <Link href="/admin" className="rounded-lg border border-white/12 bg-white/5 px-3 py-1.5 text-slate-200 hover:bg-white/8">
        대시보드
      </Link>
      <Link
        href="/admin/league/grade"
        className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3 py-1.5 text-slate-200 hover:bg-white/8"
      >
        채점
        {blackouts > 0 ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
            선거 블랙아웃 {blackouts}
            {switchOn ? ' · 차단 ON' : ' · 차단 OFF'}
          </span>
        ) : switchOn ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">한국 선거 차단 ON</span>
        ) : null}
        {pending !== null && pending > 0 ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
            채점 대기 {pending}건
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">채점 대기 0건</span>
        )}
      </Link>
      <Link href="/admin/platform-health" className="rounded-lg border border-white/12 bg-white/5 px-3 py-1.5 text-slate-200 hover:bg-white/8">
        상태
      </Link>
    </nav>
  )
}
