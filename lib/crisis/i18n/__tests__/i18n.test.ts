import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRISIS_UI, getCrisisUiPack, noveltyLabel, stageBannerText } from '../dictionary'
import { CRISIS_LOCALES, CRISIS_SELECTABLE_LOCALES } from '../locales'
import { readCookieValue, resolveCrisisLocale } from '../resolve'

describe('resolveCrisisLocale order', () => {
  it('uses the saved toggle first', () => {
    expect(resolveCrisisLocale({ saved: 'ko', acceptLanguage: 'fr-FR', ipCountry: 'JP' })).toBe('ko')
  })

  it('falls back to Accept-Language', () => {
    expect(resolveCrisisLocale({ saved: null, acceptLanguage: 'ja-JP,ja;q=0.9', ipCountry: 'KR' })).toBe('ja')
  })

  it('falls back to IP country', () => {
    expect(resolveCrisisLocale({ saved: null, acceptLanguage: null, ipCountry: 'KR' })).toBe('ko')
  })

  it('defaults to English', () => {
    expect(resolveCrisisLocale({ saved: null, acceptLanguage: null, ipCountry: null })).toBe('en')
    expect(resolveCrisisLocale({ saved: null, acceptLanguage: 'de-DE', ipCountry: 'DE' })).toBe('en')
  })
})

describe('cookie reader', () => {
  it('reads crisis_lang from a cookie header', () => {
    expect(readCookieValue('crisis_lang=ko; other=1', 'crisis_lang')).toBe('ko')
    expect(readCookieValue('a=1; crisis_lang=zh-TW', 'crisis_lang')).toBe('zh-TW')
    expect(readCookieValue(null, 'crisis_lang')).toBeNull()
  })
})

describe('Korean dictionary', () => {
  it('uses the required plain words', () => {
    const t = getCrisisUiPack('ko')
    expect(t.onlyUs).toBe('우리만 포착')
    expect(t.alsoSeenElsewhere).toBe('다른 곳도 보도')
    expect(t.baselineRisks).toBe('알려진 위험')
    expect(t.missedByOthers).toBe('남들이 놓친 신호')
    expect(t.headlineFallback).toBe('참고용')
    expect(t.stageBanner[5]).toBe('즉시 주의')
    expect(t.stageBanner[4]).toBe('경계')
    expect(t.stageBanner[3]).toBe('주의')
    expect(t.stageBanner[2]).toBe('관찰')
    expect(t.calmEmpty).toBe('현재 큰 위험 신호 없음')
    expect(noveltyLabel('only_us', t)).toBe('우리만 포착')
    expect(stageBannerText(5, t)).toBe('즉시 주의')
    expect(stageBannerText(2, t)).toBe('관찰')
    expect(stageBannerText(1, t)).toBe('현재 큰 위험 신호 없음')
    expect(t.triggerLabel('rain')).toBe('폭우')
    expect(t.triggerLabel('conflict')).toBe('분쟁')
    expect(t.triggerLabel('silence')).toBe('침묵')
    expect(t.triggerLabel('internet')).toBe('인터넷 차단')
    expect(t.triggerLabel('advisory')).toBe('여행경보')
    expect(t.triggerLabel('food')).toBe('식량')
    expect(t.triggerLabel('slow_burn')).toBe('장기 악화')
    expect(t.triggerLabel('escalation')).toBe('확전')
    expect(t.triggerLabel('health_attention')).toBe('보건 관심')
    expect(getCrisisUiPack('en').stageBanner[2]).toBe('Watch')
    expect(t.workerWaiting).toBe('분석 서버 대기 중')
    expect(t.rainForecastShort(310)).toBe('7일 강수 310mm 예보')
    expect(t.fragilityKind('dam')).toBe('댐')
    expect(t.peopleAbout('120만')).toBe('인구 약 120만 명')
  })

  it('has a pack for every locale and a complete Korean pack', () => {
    for (const locale of CRISIS_LOCALES) {
      expect(CRISIS_UI[locale]).toBeDefined()
      expect(getCrisisUiPack(locale).onlyUs.length).toBeGreaterThan(0)
      expect(getCrisisUiPack(locale).mapTitle.length).toBeGreaterThan(0)
      expect(getCrisisUiPack(locale).adminTitle.length).toBeGreaterThan(0)
    }
    expect(CRISIS_SELECTABLE_LOCALES).toContain('ko')
  })
})

describe('translation migration', () => {
  it('declares crisis_card_translations and a ledger line', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261010000003_crisis_card_translations.sql'),
      'utf8',
    )
    expect(sql).toContain('crisis_card_translations')
    expect(sql).toContain('card_id')
    expect(sql).toContain('lang')
    expect(sql).toContain('payload')
    expect(sql).toContain('created_at')
    const apply = readFileSync(path.join(process.cwd(), 'docs/crisis/APPLY_TRANSLATIONS.md'), 'utf8')
    expect(apply).toContain("VALUES ('20261010000003','20261010000003_crisis_card_translations')")
  })
})
