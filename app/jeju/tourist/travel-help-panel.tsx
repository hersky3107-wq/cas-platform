'use client'

import { useEffect, useState } from 'react'
import {
  Loader2,
  Phone,
  Landmark,
  Car,
  CreditCard,
  Coins,
  Bus,
  ExternalLink,
  MapPin,
} from 'lucide-react'
import type { ExchangeRatesData } from '@/lib/jeju/exchange'
import { useTouristUi } from '@/components/jeju/useTouristUi'

type ExchangeResult = { ok: true; data: ExchangeRatesData } | { ok: false; error: string }

/** Universal flag emoji per display code — avoids per-currency translation. */
const FLAGS: Record<string, string> = {
  USD: '🇺🇸',
  CNY: '🇨🇳',
  JPY: '🇯🇵',
  EUR: '🇪🇺',
  HKD: '🇭🇰',
  TWD: '🇹🇼',
}

/** Static emergency numbers (tappable tel: links). */
const EMERGENCY: Array<{ num: string; key: 'helpPolice' | 'helpFire' | 'helpMedical' | 'helpTravelHotline'; noteKey?: 'helpTravelHotlineNote' }> = [
  { num: '112', key: 'helpPolice' },
  { num: '119', key: 'helpFire' },
  { num: '1339', key: 'helpMedical' },
  { num: '1330', key: 'helpTravelHotline', noteKey: 'helpTravelHotlineNote' },
]

/**
 * The two consulates in Jeju. `koName` (+ address) drives the Google Maps query
 * so it resolves precisely regardless of UI language; the displayed name is
 * localized via the label key. Phone numbers are intentionally omitted (could
 * not be reliably verified) — we link the official site + map instead.
 */
const CONSULATES: Array<{
  nameKey: 'helpConsulateChina' | 'helpConsulateJapan'
  koName: string
  addr: string
  /** Romanized address (Latin) shown alongside Korean for non-ko locales. */
  roman: string
  site: string
}> = [
  {
    nameKey: 'helpConsulateChina',
    koName: '주제주 중국 총영사관',
    addr: '제주시 청사로1길 10',
    roman: 'Cheongsa-ro 1-gil 10, Jeju-si',
    site: 'https://jeju.china-consulate.gov.cn',
  },
  {
    nameKey: 'helpConsulateJapan',
    koName: '주제주 일본 총영사관',
    addr: '제주시 1100로 3351',
    roman: '1100-ro 3351, Jeju-si',
    site: 'https://www.jeju.kr.emb-japan.go.jp',
  },
]

/** Jeju anchor points for the taxi estimator (coords shared with the bus presets). */
type TaxiAnchorKey =
  | 'helpTaxiAirport'
  | 'helpTaxiCity'
  | 'helpTaxiTerminal'
  | 'helpTaxiJungmun'
  | 'helpTaxiSeogwipo'
  | 'helpTaxiSeongsan'
  | 'helpTaxiHamdeok'
  | 'helpTaxiAewol'
  | 'helpTaxiHyeopjae'
  | 'helpTaxiUdo'
  | 'helpTaxiHallasan'
  | 'helpTaxiDongmun'

const TAXI_ANCHORS: ReadonlyArray<{ key: TaxiAnchorKey; lat: number; lng: number }> = [
  { key: 'helpTaxiAirport', lat: 33.5063, lng: 126.4929 },
  { key: 'helpTaxiCity', lat: 33.4996, lng: 126.5312 },
  { key: 'helpTaxiTerminal', lat: 33.4996, lng: 126.5135 },
  { key: 'helpTaxiJungmun', lat: 33.2496, lng: 126.4116 },
  { key: 'helpTaxiSeogwipo', lat: 33.2542, lng: 126.56 },
  { key: 'helpTaxiSeongsan', lat: 33.4587, lng: 126.9425 },
  { key: 'helpTaxiHamdeok', lat: 33.5435, lng: 126.6694 },
  { key: 'helpTaxiAewol', lat: 33.4628, lng: 126.3097 },
  { key: 'helpTaxiHyeopjae', lat: 33.394, lng: 126.2396 },
  { key: 'helpTaxiUdo', lat: 33.4748, lng: 126.943 },
  { key: 'helpTaxiHallasan', lat: 33.3853, lng: 126.613 },
  { key: 'helpTaxiDongmun', lat: 33.5125, lng: 126.5267 },
]

/**
 * Jeju mid-size (중형) taxi meter — 2024.7 기준.
 * Base 4,300원 covers the first 2 km, then 100원 per 126 m. Straight-line
 * distance is scaled by a road factor (Jeju roads wind), and trips ≥ 20 km add
 * a long-distance surcharge on the distance portion.
 */
const FARE = {
  basFare: 4300,
  baseKm: 2,
  perMeterWon: 100 / 126,
  longDistanceKm: 20,
  longDistanceSurcharge: 1.2,
  roadFactor: 1.4,
} as const

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Estimated road km + fare range (±15%) for a trip between two anchor coords. */
function estimateFare(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): { roadKm: number; low: number; high: number } {
  const roadKm = haversineKm(a.lat, a.lng, b.lat, b.lng) * FARE.roadFactor
  const extraKm = Math.max(0, roadKm - FARE.baseKm)
  let distWon = extraKm * 1000 * FARE.perMeterWon
  if (roadKm >= FARE.longDistanceKm) distWon *= FARE.longDistanceSurcharge
  const fare = FARE.basFare + distWon
  const round100 = (n: number) => Math.round(n / 100) * 100
  return {
    roadKm: Math.round(roadKm),
    low: round100(fare * 0.85),
    high: round100(fare * 1.15),
  }
}

function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[20px] bg-white/85 p-4 shadow-[0_10px_28px_-18px_rgba(0,112,122,0.55)] ring-1 ring-[#00A8B5]/12 backdrop-blur">
      <h4 className="flex items-center gap-1.5 text-[14px] font-extrabold text-[#0A2B30]">
        <span className="text-[#00A8B5]">{icon}</span>
        {title}
      </h4>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function TravelHelpPanel({ onOpenBus }: { onOpenBus?: () => void }) {
  const { t, locale } = useTouristUi()
  const [rates, setRates] = useState<ExchangeRatesData | null>(null)
  const [loadingRates, setLoadingRates] = useState(true)
  const [ratesError, setRatesError] = useState(false)

  // Taxi estimator selections (default From = airport, To = Jeju City).
  const [fromIdx, setFromIdx] = useState(0)
  const [toIdx, setToIdx] = useState(1)
  const fare =
    fromIdx === toIdx ? null : estimateFare(TAXI_ANCHORS[fromIdx]!, TAXI_ANCHORS[toIdx]!)
  const wonFmt = (n: number) => n.toLocaleString('en-US')

  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    ;(async () => {
      try {
        const res = await fetch('/api/jeju/exchange', { signal: ctrl.signal })
        const data = (await res.json()) as ExchangeResult
        if (!alive) return
        if (data.ok) setRates(data.data)
        else setRatesError(true)
      } catch {
        if (alive) setRatesError(true)
      } finally {
        clearTimeout(timer)
        if (alive) setLoadingRates(false)
      }
    })()
    return () => {
      alive = false
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [])

  function formatRate(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  return (
    <section className="mt-6">
      <h3 className="text-base font-extrabold tracking-tight text-[#0A2B30]">{t.helpHeading}</h3>

      <div className="mt-4 flex flex-col gap-3">
        {/* ── 1. Exchange rates (live) ─────────────────────────────────── */}
        <SectionCard icon={<Coins size={16} strokeWidth={2.5} aria-hidden />} title={t.helpExchangeTitle}>
          {loadingRates ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[13px] font-semibold text-[#00707A]">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              {t.helpExchangeLoading}
            </div>
          ) : ratesError || !rates ? (
            <p className="rounded-[12px] bg-[#FFF6E5] px-3 py-2.5 text-[12.5px] font-semibold text-[#B8860B]">
              {t.helpExchangeError}
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-2">
                {rates.rates.map((r) => (
                  <li
                    key={r.code}
                    className="flex items-center justify-between gap-2 rounded-[12px] bg-white px-3 py-2 shadow-[0_4px_14px_-10px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/10"
                  >
                    <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#0A2B30]">
                      <span aria-hidden>{FLAGS[r.code] ?? '💱'}</span>
                      {r.unit > 1 ? `${r.unit} ` : ''}
                      {r.code}
                    </span>
                    <span className="text-[12.5px] font-bold text-[#00707A]">
                      ₩{formatRate(r.rate)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11px] font-semibold text-slate-400">
                {t.helpExchangeAsOf} {rates.date}
              </p>
              <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-400">
                {t.helpExchangeNote}
              </p>
            </>
          )}
        </SectionCard>

        {/* ── 2. Emergency numbers (always shown, tap to call) ─────────── */}
        <SectionCard icon={<Phone size={16} strokeWidth={2.5} aria-hidden />} title={t.helpEmergencyTitle}>
          <ul className="flex flex-col gap-2">
            {EMERGENCY.map((e) => (
              <li key={e.num}>
                <a
                  href={`tel:${e.num}`}
                  className="flex items-center justify-between gap-3 rounded-[12px] bg-white px-3 py-2.5 shadow-[0_4px_14px_-10px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/10 transition-transform hover:-translate-y-0.5"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-extrabold text-[#0A2B30]">{t[e.key]}</span>
                    {e.noteKey && (
                      <span className="block text-[11px] font-semibold text-[#C2185B]">{t[e.noteKey]}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[16px] font-extrabold text-[#00A8B5]">{e.num}</span>
                    <Phone size={13} strokeWidth={2.5} className="text-[#00A8B5]" aria-hidden />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] font-medium text-slate-400">{t.helpTapToCall}</p>
        </SectionCard>

        {/* ── 3. Consulates (static) ───────────────────────────────────── */}
        <SectionCard icon={<Landmark size={16} strokeWidth={2.5} aria-hidden />} title={t.helpConsulateTitle}>
          <ul className="flex flex-col gap-2.5">
            {CONSULATES.map((c) => (
              <li
                key={c.nameKey}
                className="rounded-[12px] bg-white px-3 py-2.5 shadow-[0_4px_14px_-10px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/10"
              >
                <p className="text-[13px] font-extrabold text-[#0A2B30]">{t[c.nameKey]}</p>
                <p className="mt-0.5 text-[11.5px] font-medium text-slate-500">
                  {locale === 'ko' ? c.addr : `${c.roman} (${c.addr})`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <a
                    href={c.site}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-[#F0FAFB] px-2.5 py-1 text-[11px] font-bold text-[#00707A] transition-opacity hover:opacity-80"
                  >
                    {t.helpOfficialSite}
                    <ExternalLink size={10} strokeWidth={2.5} aria-hidden />
                  </a>
                  <a
                    href={googleMapsUrl(`${c.koName} ${c.addr}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-[#F0FAFB] px-2.5 py-1 text-[11px] font-bold text-[#00707A] transition-opacity hover:opacity-80"
                  >
                    <MapPin size={10} strokeWidth={2.5} aria-hidden />
                    {t.helpViewMap}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* ── 4. Getting around ────────────────────────────────────────── */}
        <SectionCard icon={<Car size={16} strokeWidth={2.5} aria-hidden />} title={t.helpAroundTitle}>
          <p className="rounded-[12px] bg-[#E3F0FF] px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1C6DD0]">
            {t.helpMapsNote}
          </p>

          <p className="mt-3 text-[12.5px] font-extrabold text-[#0A2B30]">{t.helpTaxiTitle}</p>

          {/* From / To anchor dropdowns */}
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {([
              { label: t.helpTaxiFrom, value: fromIdx, set: setFromIdx },
              { label: t.helpTaxiTo, value: toIdx, set: setToIdx },
            ] as const).map((sel, i) => (
              <label key={i} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-[#5A7176]">{sel.label}</span>
                <select
                  value={sel.value}
                  onChange={(e) => sel.set(Number(e.target.value))}
                  className="rounded-[12px] bg-white px-3 py-2 text-[12.5px] font-bold text-[#0A2B30] shadow-[0_4px_14px_-10px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/15 focus:outline-none focus:ring-[#00A8B5]/50"
                >
                  {TAXI_ANCHORS.map((anchor, idx) => (
                    <option key={anchor.key} value={idx}>
                      {t[anchor.key]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {/* Estimated fare result */}
          {fare ? (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[14px] bg-[#F0FAFB] px-3.5 py-3 ring-1 ring-[#00A8B5]/15">
              <span className="text-[12px] font-bold text-[#00707A]">
                {t.helpTaxiEstimatedFare}
                <span className="ml-1 text-[11px] font-semibold text-slate-400">≈ {fare.roadKm} km</span>
              </span>
              <span className="shrink-0 text-[15px] font-extrabold text-[#0A2B30]">
                ₩{wonFmt(fare.low)}–{wonFmt(fare.high)}
              </span>
            </div>
          ) : (
            <p className="mt-2.5 rounded-[12px] bg-[#FFF6E5] px-3 py-2.5 text-[12px] font-semibold text-[#B8860B]">
              {t.helpTaxiSamePoint}
            </p>
          )}

          <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-400">{t.helpTaxiDisclaimer}</p>
          <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-400">{t.helpTaxiNote}</p>

          {onOpenBus && (
            <button
              type="button"
              onClick={onOpenBus}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#0A2B30] px-3.5 py-2 text-[12.5px] font-extrabold text-white shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <Bus size={14} strokeWidth={2.5} aria-hidden />
              {t.helpBusLink}
            </button>
          )}
        </SectionCard>

        {/* ── 5. Payment tips ──────────────────────────────────────────── */}
        <SectionCard icon={<CreditCard size={16} strokeWidth={2.5} aria-hidden />} title={t.helpPaymentTitle}>
          <p className="text-[12.5px] font-medium leading-relaxed text-[#0A2B30]">{t.helpPaymentBody}</p>
        </SectionCard>
      </div>
    </section>
  )
}
