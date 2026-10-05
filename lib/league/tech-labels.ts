/**
 * Tech card sides and header — verb-based, never "실현/불발" or raw "tech".
 */

import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { decodeOpenTechInstrument } from '@/lib/league/gateway/adapters/tech-resolve'
import { decodeTechInstrument } from '@/lib/league/gateway/adapters/tech-catalog'
import type { TechEventId } from '@/lib/league/gateway/adapters/tech-resolve'

export type TechVerbPair = { yes: string; no: string; noun: string }

const TABLE: Record<TechEventId, Record<LeagueLocale, TechVerbPair>> = {
  announce: {
    en: { yes: 'Announces', no: "Doesn't", noun: 'announce' },
    ko: { yes: '발표함', no: '발표 안 함', noun: '발표 여부' },
    ja: { yes: '発表する', no: '発表しない', noun: '発表' },
    'zh-TW': { yes: '宣佈', no: '不宣佈', noun: '宣佈' },
    fr: { yes: 'Annonce', no: "N'annonce pas", noun: 'annonce' },
    es: { yes: 'Anuncia', no: 'No anuncia', noun: 'anuncio' },
    pt: { yes: 'Anuncia', no: 'Não anuncia', noun: 'anúncio' },
    ar: { yes: 'يعلن', no: 'لا يعلن', noun: 'إعلان' },
  },
  publish: {
    en: { yes: 'Publishes', no: "Doesn't", noun: 'publish' },
    ko: { yes: '공개함', no: '공개 안 함', noun: '공개 여부' },
    ja: { yes: '公開する', no: '公開しない', noun: '公開' },
    'zh-TW': { yes: '公開', no: '不公開', noun: '公開' },
    fr: { yes: 'Publie', no: 'Ne publie pas', noun: 'publication' },
    es: { yes: 'Publica', no: 'No publica', noun: 'publicación' },
    pt: { yes: 'Publica', no: 'Não publica', noun: 'publicação' },
    ar: { yes: 'ينشر', no: 'لا ينشر', noun: 'نشر' },
  },
  release: {
    en: { yes: 'Releases', no: "Doesn't", noun: 'release' },
    ko: { yes: '출시함', no: '출시 안 함', noun: '출시 여부' },
    ja: { yes: '発売する', no: '発売しない', noun: '発売' },
    'zh-TW': { yes: '發佈', no: '不發佈', noun: '發佈' },
    fr: { yes: 'Sort', no: 'Ne sort pas', noun: 'sortie' },
    es: { yes: 'Lanza', no: 'No lanza', noun: 'lanzamiento' },
    pt: { yes: 'Lança', no: 'Não lança', noun: 'lançamento' },
    ar: { yes: 'يصدر', no: 'لا يصدر', noun: 'إصدار' },
  },
  ship: {
    en: { yes: 'Ships', no: "Doesn't", noun: 'ship' },
    ko: { yes: '출하함', no: '출하 안 함', noun: '출하 여부' },
    ja: { yes: '出荷する', no: '出荷しない', noun: '出荷' },
    'zh-TW': { yes: '出貨', no: '不出貨', noun: '出貨' },
    fr: { yes: 'Expédie', no: "N'expédie pas", noun: 'expédition' },
    es: { yes: 'Envía', no: 'No envía', noun: 'envío' },
    pt: { yes: 'Envia', no: 'Não envia', noun: 'envio' },
    ar: { yes: 'يشحن', no: 'لا يشحن', noun: 'شحن' },
  },
  launch: {
    en: { yes: 'Launches', no: "Doesn't", noun: 'launch' },
    ko: { yes: '발사함', no: '발사 안 함', noun: '발사 여부' },
    ja: { yes: '打ち上げる', no: '打ち上げない', noun: '打ち上げ' },
    'zh-TW': { yes: '發射', no: '不發射', noun: '發射' },
    fr: { yes: 'Lance', no: 'Ne lance pas', noun: 'lancement' },
    es: { yes: 'Lanza', no: 'No lanza', noun: 'lanzamiento' },
    pt: { yes: 'Lança', no: 'Não lança', noun: 'lançamento' },
    ar: { yes: 'يطلق', no: 'لا يطلق', noun: 'إطلاق' },
  },
  approve: {
    en: { yes: 'Approves', no: "Doesn't", noun: 'approve' },
    ko: { yes: '승인함', no: '승인 안 함', noun: '승인 여부' },
    ja: { yes: '承認する', no: '承認しない', noun: '承認' },
    'zh-TW': { yes: '批准', no: '不批准', noun: '批准' },
    fr: { yes: 'Approuve', no: "N'approuve pas", noun: 'approbation' },
    es: { yes: 'Aprueba', no: 'No aprueba', noun: 'aprobación' },
    pt: { yes: 'Aprova', no: 'Não aprova', noun: 'aprovação' },
    ar: { yes: 'يوافق', no: 'لا يوافق', noun: 'موافقة' },
  },
  file: {
    en: { yes: 'Files', no: "Doesn't", noun: 'file' },
    ko: { yes: '제출함', no: '제출 안 함', noun: '제출 여부' },
    ja: { yes: '提出する', no: '提出しない', noun: '提出' },
    'zh-TW': { yes: '提交', no: '不提交', noun: '提交' },
    fr: { yes: 'Dépose', no: 'Ne dépose pas', noun: 'dépôt' },
    es: { yes: 'Presenta', no: 'No presenta', noun: 'presentación' },
    pt: { yes: 'Submete', no: 'Não submete', noun: 'submissão' },
    ar: { yes: 'يقدم', no: 'لا يقدم', noun: 'تقديم' },
  },
  acquire: {
    en: { yes: 'Acquires', no: "Doesn't", noun: 'acquire' },
    ko: { yes: '인수함', no: '인수 안 함', noun: '인수 여부' },
    ja: { yes: '買収する', no: '買収しない', noun: '買収' },
    'zh-TW': { yes: '收購', no: '不收購', noun: '收購' },
    fr: { yes: 'Acquiert', no: "N'acquiert pas", noun: 'acquisition' },
    es: { yes: 'Adquiere', no: 'No adquiere', noun: 'adquisición' },
    pt: { yes: 'Adquire', no: 'Não adquire', noun: 'aquisição' },
    ar: { yes: 'يستحوذ', no: 'لا يستحوذ', noun: 'استحواذ' },
  },
}

export function techEventFromInstrument(instrument: string | null | undefined): TechEventId | null {
  if (!instrument) return null
  const open = decodeOpenTechInstrument(instrument)
  if (open) return open.event
  if (decodeTechInstrument(instrument)) return 'publish'
  return null
}

export function techVerbPair(event: TechEventId, locale: LeagueLocale): TechVerbPair {
  return TABLE[event][locale] ?? TABLE[event].en
}

export function techCardHeaderLine(args: {
  subject: string
  event: TechEventId
  horizonLabel: string
  locale: LeagueLocale
}): string {
  const pair = techVerbPair(args.event, args.locale)
  return `${args.subject} · ${pair.noun} · ${args.horizonLabel}`
}
