/**
 * Copy that names what the centre actually is. Never claims twelve systems
 * independently found the same 오행 — that is the axis projection, one vector.
 */

import type { FiveElement } from '../engines/calendar'
import type { TalismanCentre } from './types'
import { pickDeficiencyLeader } from './centre'

export { pickDeficiencyLeader }

export const ELEMENT_KO: Record<FiveElement, string> = {
  wood: '목(木)',
  fire: '화(火)',
  earth: '토(土)',
  metal: '금(金)',
  water: '수(水)',
}

export function describeCentre(centre: TalismanCentre): { headline: string; body: string } {
  if (centre.source === 'eokbu') {
    const el = ELEMENT_KO[centre.element]
    if (centre.mode === 'fill') {
      return {
        headline: `억부 용신은 ${el}입니다`,
        body: '사주 신약이라 인성으로 그 오행을 채웁니다. 열두 체계가 합의한 값이 아닙니다.',
      }
    }
    return {
      headline: `억부 용신은 ${el}입니다`,
      body: '사주 신강이라 식상으로 그 오행을 흘립니다. 가운데는 속이 빈 핵입니다. 열두 체계가 합의한 값이 아닙니다.',
    }
  }
  if (centre.source === 'eokbu-lean') {
    const el = ELEMENT_KO[centre.element]
    return {
      headline: `억부 경향의 용신은 ${el}입니다`,
      body:
        centre.mode === 'fill'
          ? '중화라 용신을 확정하지 않았지만, 득령이 없어 신약 쪽으로 기울입니다. 열두 체계가 합의한 값이 아닙니다.'
          : '중화라 용신을 확정하지 않았지만, 득령이 있어 신강 쪽으로 기울입니다. 열두 체계가 합의한 값이 아닙니다.',
    }
  }
  if (centre.source === 'jonggyeok') {
    return {
      headline: `종격의 주된 오행은 ${ELEMENT_KO[centre.element]}입니다`,
      body: '억부가 편왕으로 판정불가여서 그 오행을 따릅니다. 열두 체계가 합의한 값이 아닙니다.',
    }
  }
  if (!centre.element) {
    return {
      headline: '이번 판독에서는 크게 부족한 기운이 없습니다',
      body: '사주가 없어 가운데를 비웁니다. 부족을 채우는 부적보다는 흐름을 지키는 쪽입니다.',
    }
  }
  return {
    headline: `오행 축에서 가장 빈 기운은 ${ELEMENT_KO[centre.element]}입니다`,
    body: '사주가 없어 오행 축의 결핍값을 가운데에 둡니다. 투영 한 줄이지, 열두 체계가 같은 오행을 가리킨 결과가 아닙니다.',
  }
}

export function describeCentreFromDeficiency(
  deficiency: Partial<Record<FiveElement, number>> | Record<string, unknown> | null | undefined,
): { headline: string; body: string } {
  return describeCentre({
    source: 'consensus',
    mode: 'fill',
    element: pickDeficiencyLeader(deficiency),
    intensity: 'full',
  })
}
