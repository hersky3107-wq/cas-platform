/**
 * TECH:OPEN object precision. Broad nouns (gpu, phone, product) cannot be
 * graded without pinning what counts. Pure.
 */

export const TECH_OBJECT_SCOPES = ['new_product_any', 'datacenter', 'consumer'] as const
export type TechObjectScope = (typeof TECH_OBJECT_SCOPES)[number]

const BROAD_RE =
  /^(?:(?:a|the|new|새|새로운)\s+)*(?:gpus?|그래픽(?:\s*카드)?|chips?|processors?|phones?|smartphones?|products?|models?|칩|폰|스마트폰|제품|모델|그래픽카드)$/i

export function isBroadTechObject(object: string | null | undefined): boolean {
  if (!object) return false
  const cleaned = object.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return BROAD_RE.test(cleaned)
}

export function isGpuFamilyObject(object: string): boolean {
  return /gpu|그래픽/i.test(object)
}

export function techObjectScopeLabel(
  scope: TechObjectScope,
  object: string,
  locale: 'ko' | 'en' = 'ko',
): string {
  const gpu = isGpuFamilyObject(object)
  if (locale === 'en') {
    if (gpu) {
      switch (scope) {
        case 'new_product_any':
          return 'New GPU product official announcement — datacenter and consumer; exclude launch/re-announce of an already-announced product'
        case 'datacenter':
          return 'Datacenter GPU only — new official product announcement; exclude launch/re-announce of an already-announced product'
        case 'consumer':
          return 'Consumer GPU only — new official product announcement; exclude launch/re-announce of an already-announced product'
      }
    }
    switch (scope) {
      case 'new_product_any':
        return 'New official product announcement — exclude launch/re-announce of an already-announced product'
      case 'datacenter':
        return 'Enterprise/server product only — new official announcement'
      case 'consumer':
        return 'Consumer product only — new official announcement'
    }
  }
  if (gpu) {
    switch (scope) {
      case 'new_product_any':
        return '새 GPU 제품 공식 발표 — 데이터센터·소비자 포함, 이미 발표된 제품의 출시·재공지는 제외'
      case 'datacenter':
        return '데이터센터 GPU만 — 새 제품 공식 발표 (이미 발표된 제품의 출시·재공지 제외)'
      case 'consumer':
        return '소비자 GPU만 — 새 제품 공식 발표 (이미 발표된 제품의 출시·재공지 제외)'
    }
  }
  switch (scope) {
    case 'new_product_any':
      return '새 제품 공식 발표 — 이미 발표된 제품의 출시·재공지는 제외'
    case 'datacenter':
      return '기업·서버용만 — 새 제품 공식 발표 (이미 발표된 제품의 출시·재공지 제외)'
    case 'consumer':
      return '소비자용만 — 새 제품 공식 발표 (이미 발표된 제품의 출시·재공지 제외)'
  }
}

export function applyTechObjectScope(
  object: string,
  scope: string | null | undefined,
  locale: 'ko' | 'en' = 'en',
): string {
  if (!isBroadTechObject(object)) return object.trim()
  if (isTechObjectScope(scope)) return techObjectScopeLabel(scope, object, locale)
  if (isGpuFamilyObject(object)) return techObjectScopeLabel('new_product_any', object, locale)
  return object.trim()
}

export function isTechObjectScope(raw: string | null | undefined): raw is TechObjectScope {
  return typeof raw === 'string' && (TECH_OBJECT_SCOPES as readonly string[]).includes(raw)
}

export function techObjectScopeOptions(
  object: string,
  locale: 'ko' | 'en' = 'ko',
): { id: TechObjectScope; label: string }[] {
  return TECH_OBJECT_SCOPES.map((id) => ({ id, label: techObjectScopeLabel(id, object, locale) }))
}
