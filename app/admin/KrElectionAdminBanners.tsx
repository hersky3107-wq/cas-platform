'use client'

import { useCallback, useEffect, useState } from 'react'

type Banner = {
  electionId: string
  title: string
  stage: 'prepare' | 'warn' | 'blackout' | 'post'
  color: 'yellow' | 'orange' | 'red' | 'green'
  text: string
  showToggle: boolean
}

const COLOR_CLASS: Record<Banner['color'], string> = {
  yellow: 'border-amber-400/50 bg-amber-500/20 text-amber-50',
  orange: 'border-orange-400/50 bg-orange-600/25 text-orange-50',
  red: 'border-red-500/50 bg-red-600/20 text-red-50',
  green: 'border-emerald-400/50 bg-emerald-600/20 text-emerald-50',
}

export function KrElectionAdminBanners() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [switchOn, setSwitchOn] = useState(false)
  const [switchValue, setSwitchValue] = useState('off')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/league/blackout', { credentials: 'include' })
      const body = (await res.json().catch(() => null)) as {
        banners?: Banner[]
        switch?: { on?: boolean; value?: string }
      } | null
      if (!res.ok) {
        setBanners([])
        return
      }
      setBanners(Array.isArray(body?.banners) ? body.banners : [])
      setSwitchOn(Boolean(body?.switch?.on))
      setSwitchValue(body?.switch?.value ?? 'off')
    } catch {
      setBanners([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function setSwitch(value: 'all_kr' | 'off') {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/league/blackout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const body = (await res.json().catch(() => null)) as { switch?: { on?: boolean; value?: string } }
      if (res.ok) {
        setSwitchOn(Boolean(body?.switch?.on))
        setSwitchValue(body?.switch?.value ?? value)
        await refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  if (banners.length === 0) return null

  return (
    <div className="border-b border-white/10 bg-[#0a0f1e] px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        {banners.map((banner) => (
          <div
            key={banner.electionId}
            className={`rounded-xl border px-4 py-3 text-sm ${COLOR_CLASS[banner.color]}`}
          >
            <p className="font-semibold leading-snug">{banner.text}</p>
            {banner.showToggle ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void setSwitch('all_kr')}
                  className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  한국 선거 전부 차단
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void setSwitch('off')}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
                >
                  차단 해제
                </button>
                <span className="text-xs opacity-90">
                  현재: {switchOn ? 'ON' : 'OFF'} ({switchValue})
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
