'use client'

import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

const PLANNED_FEATURES = [
  { icon: '🗣', ko: '다국어 안내', en: 'Multilingual guide' },
  { icon: '🗺', ko: '관광지 번역', en: 'Attraction translation' },
  { icon: '🤝', ko: '대행·예약 도움', en: 'Concierge & booking' },
  { icon: '📞', ko: '현지 통역 연결', en: 'Local interpreter link' },
] as const

export default function JejuTouristForeignPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="tourist"
      title={t.foreignTitle}
      tagline="Coming soon / 준비 중"
      backHref="/jeju/tourist"
      backLabel={t.backToTourist}
    >
      <div className="mx-auto max-w-lg">
        {/* Status card */}
        <div className="mb-8 rounded-2xl border border-jeju-border bg-jeju-bg-elevated px-6 py-8 text-center shadow-[var(--jeju-shadow)]">
          <p className="text-5xl leading-none" aria-hidden>🌏</p>
          <h2 className="mt-4 text-xl font-bold text-jeju-fg">
            외국인 관광객 전용 서비스
          </h2>
          <p className="mt-1 text-sm font-semibold text-jeju-accent">
            Coming soon
          </p>
          <p className="mt-4 text-sm leading-relaxed text-jeju-fg-muted">
            번역·대행·여행 안내 서비스를 준비 중입니다.<br />
            Translation, concierge and travel assistance service is coming.
          </p>
        </div>

        {/* Planned features list */}
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
          준비 중인 기능 / Planned features
        </p>
        <ul className="flex flex-col gap-3">
          {PLANNED_FEATURES.map((f) => (
            <li
              key={f.en}
              className="flex items-center gap-4 rounded-xl border border-jeju-border bg-jeju-tile-bg px-5 py-4"
            >
              <span className="text-2xl leading-none" aria-hidden>{f.icon}</span>
              <div>
                <p className="font-semibold text-jeju-fg">{f.ko}</p>
                <p className="text-xs text-jeju-fg-muted">{f.en}</p>
              </div>
              <span className="ml-auto rounded-full border border-jeju-border px-2 py-0.5 text-[10px] text-jeju-fg-muted">
                준비 중
              </span>
            </li>
          ))}
        </ul>
      </div>
    </JejuThemeShell>
  )
}
