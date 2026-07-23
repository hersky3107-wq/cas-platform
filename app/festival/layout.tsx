import type { Metadata } from 'next'

import { FestivalStandaloneChrome } from './standalone-chrome'

export const metadata: Metadata = {
  title: '축제 흥행 예측 · 성공을 위한 기획 보완 진단',
  description:
    '축제 흥행 가능성 예측과 기획 보완 진단. 8명의 AI 조사관이 조사·토론하고, 보완 처방까지 제시합니다.',
}

/**
 * Standalone competition demo layout — no AIMANI lobby nav, no back link.
 * Public access (no login) is enforced in middleware.ts for /festival and
 * /api/festival/*; this layout suppresses global credit chrome for judges.
 */
export default function FestivalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FestivalStandaloneChrome />
      {children}
    </>
  )
}
