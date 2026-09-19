/**
 * Extra seats that are not wired yet. Persist an honest 결번 row so the
 * seat exists on the board (미응답) without inventing a ballot that would
 * later be graded as if an engine had spoken.
 */
import type { ExtraSeatId } from './seats'

export const EXTRA_STUB_REASON: Record<Exclude<ExtraSeatId, 'divination'>, string> = {
  sentiment: '심리·내러티브 좌석 — 뉴스·루머·소셜만 읽고 데이터 패킷은 받지 않습니다. 엔진 연결 전 좌석입니다.',
  history: '역사·패턴 좌석 — 이 라운드 패킷의 가격 시계열만 읽고 외부 소스는 쓰지 않습니다. 엔진 연결 전 좌석입니다.',
  consensus: '돈이 매긴 확률 좌석 — 시장이 매긴 합의 확률. 엔진 연결 전 좌석입니다.',
}

export function extraStubReason(id: Exclude<ExtraSeatId, 'divination'>): string {
  return EXTRA_STUB_REASON[id]
}
