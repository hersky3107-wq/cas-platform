'use client'

import {
  Sparkles,
  AlertTriangle,
  Car,
  UtensilsCrossed,
  Wallet,
  QrCode,
  Ticket,
  Landmark,
  Scale,
  Signal,
  CreditCard,
  Building2,
} from 'lucide-react'
import type { TouristUiPack } from '@/lib/jeju/tourist-labels'
import { useTouristUi } from '@/components/jeju/useTouristUi'

/**
 * Coming Soon / Vision panel — a NON-FUNCTIONAL policy-proposal showcase.
 *
 * It frames the structural barrier foreigners face in Korea (phone number = de
 * facto ID) and positions AX JEJU as the bridge/broker technology partner that
 * Jeju Province could build with telecoms, card companies, banks, and the
 * government. There are NO functional controls and NO data collection — it is a
 * deliberately bold "what should be built" vision, clearly badged BETA / planned.
 */

/** Blocked-service problem cards (icon + localized title/body keys). */
const BLOCKED: Array<{
  icon: React.ReactNode
  emoji: string
  titleKey: keyof TouristUiPack
  bodyKey: keyof TouristUiPack
}> = [
  { icon: <Car size={16} strokeWidth={2.5} aria-hidden />, emoji: '🚕', titleKey: 'csBlockRideTitle', bodyKey: 'csBlockRideBody' },
  { icon: <UtensilsCrossed size={16} strokeWidth={2.5} aria-hidden />, emoji: '🍗', titleKey: 'csBlockFoodTitle', bodyKey: 'csBlockFoodBody' },
  { icon: <Wallet size={16} strokeWidth={2.5} aria-hidden />, emoji: '💳', titleKey: 'csBlockPayTitle', bodyKey: 'csBlockPayBody' },
  { icon: <QrCode size={16} strokeWidth={2.5} aria-hidden />, emoji: '📱', titleKey: 'csBlockQrTitle', bodyKey: 'csBlockQrBody' },
  { icon: <Ticket size={16} strokeWidth={2.5} aria-hidden />, emoji: '🎫', titleKey: 'csBlockBookingTitle', bodyKey: 'csBlockBookingBody' },
]

/** Institutions the proposal requires — shown as a chip row, non-interactive. */
const NEEDS: Array<{ icon: React.ReactNode; key: keyof TouristUiPack }> = [
  { icon: <Landmark size={13} strokeWidth={2.5} aria-hidden />, key: 'csProposalNeedsGov' },
  { icon: <Scale size={13} strokeWidth={2.5} aria-hidden />, key: 'csProposalNeedsLaw' },
  { icon: <Signal size={13} strokeWidth={2.5} aria-hidden />, key: 'csProposalNeedsTelecom' },
  { icon: <CreditCard size={13} strokeWidth={2.5} aria-hidden />, key: 'csProposalNeedsCard' },
  { icon: <Building2 size={13} strokeWidth={2.5} aria-hidden />, key: 'csProposalNeedsBank' },
]

export function ComingSoonPanel() {
  const { t } = useTouristUi()

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-extrabold tracking-tight text-[#0A2B30]">{t.csHeading}</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#0A2B30] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[#7FE9F0]">
          <Sparkles size={11} strokeWidth={2.5} aria-hidden />
          {t.csBetaBadge}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {/* ── 1. Problem statement (the hook) ──────────────────────────── */}
        <div className="overflow-hidden rounded-[20px] bg-gradient-to-br from-[#0A2B30] to-[#00707A] p-5 text-white shadow-[0_18px_40px_-22px_rgba(0,112,122,0.9)]">
          <h4 className="text-[16px] font-extrabold leading-snug">{t.csIntroTitle}</h4>
          <p className="mt-2.5 text-[12.5px] font-medium leading-relaxed text-white/85">{t.csIntroBody}</p>
        </div>

        {/* ── 2. What's blocked (problem cards) ────────────────────────── */}
        <div>
          <h4 className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#0A2B30]">
            <AlertTriangle size={15} strokeWidth={2.5} className="text-[#C2185B]" aria-hidden />
            {t.csBlockedTitle}
          </h4>
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {BLOCKED.map((b) => (
              <div
                key={b.titleKey}
                className="rounded-[16px] bg-white/85 p-3.5 shadow-[0_10px_28px_-18px_rgba(0,112,122,0.55)] ring-1 ring-[#00A8B5]/12 backdrop-blur"
              >
                <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#0A2B30]">
                  <span aria-hidden>{b.emoji}</span>
                  {t[b.titleKey]}
                </p>
                <p className="mt-1.5 text-[11.5px] font-medium leading-relaxed text-slate-500">{t[b.bodyKey]}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 3. The proposal / vision (the bold ask) ──────────────────── */}
        <div className="rounded-[22px] bg-white p-5 shadow-[0_18px_44px_-24px_rgba(0,112,122,0.7)] ring-1 ring-[#00A8B5]/25">
          <span className="inline-flex items-center rounded-full bg-[#E7FBFD] px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#00707A]">
            {t.csProposalLabel}
          </span>
          <h4 className="mt-3 text-[16px] font-extrabold leading-snug text-[#0A2B30]">{t.csProposalTitle}</h4>
          <p className="mt-2.5 text-[12.5px] font-medium leading-relaxed text-[#0A2B30]/80">{t.csProposalBody}</p>

          <div className="mt-4 rounded-[16px] bg-[#F0FAFB] p-4">
            <p className="flex items-start gap-2 text-[12.5px] font-semibold leading-relaxed text-[#00707A]">
              <Sparkles size={15} strokeWidth={2.5} className="mt-0.5 shrink-0 text-[#00A8B5]" aria-hidden />
              {t.csProposalRoleBody}
            </p>
          </div>

          <p className="mt-4 text-[12px] font-extrabold text-[#0A2B30]">{t.csProposalNeedsTitle}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {NEEDS.map((n) => (
              <span
                key={n.key}
                className="inline-flex items-center gap-1 rounded-full bg-[#0A2B30]/[0.06] px-2.5 py-1 text-[11px] font-bold text-[#0A2B30]"
              >
                <span className="text-[#00A8B5]">{n.icon}</span>
                {t[n.key]}
              </span>
            ))}
          </div>

          <p className="mt-4 border-t border-[#00A8B5]/15 pt-3 text-[12px] font-medium leading-relaxed text-slate-500">
            {t.csProposalClosing}
          </p>
        </div>
      </div>
    </section>
  )
}
