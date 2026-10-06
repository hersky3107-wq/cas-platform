/**
 * Extra-seat explanations: one name, one role line, one basis line per seat,
 * in every league locale. Tiles render role and basis always visible; the
 * leaderboard reuses the same pack.
 *
 * Sports and politics surfaces never show the betting word, so the market
 * baseline seat carries a second basis line for those categories.
 */

import type { LeagueLocale } from '../i18n/locales'
import { isPoliticsLedgerCategory } from './politics-category'
import type { ExtraSeatId } from './seats'
import { isSportsLedgerCategory } from './sports-category'

export type ExtraSeatDescription = {
  name: string
  role: string
  basis: string
}

export type ExtraDescriptionPack = {
  roleLabel: string
  basisLabel: string
  /** Market baseline tile when the seat sat out because nothing is priced with money. */
  noMarket: string
  seats: Record<ExtraSeatId, ExtraSeatDescription>
  consensusBasisNoBetting: string
}

const ko: ExtraDescriptionPack = {
  roleLabel: '역할',
  basisLabel: '판단 근거',
  noMarket: '이 종목에는 돈이 걸린 시장이 없습니다',
  seats: {
    divination: {
      name: '점술',
      role: '오락용 점괘',
      basis: '날짜·괘·타로·룬, 대상의 연주·월주, 부동산은 구성기학 방위. 시장 데이터는 보지 않음',
    },
    sentiment: { name: '심리·내러티브', role: '여론의 방향', basis: '웹에 드러난 화제·기사 톤' },
    history: { name: '역사·패턴', role: '과거와 닮은 흐름 찾기', basis: '가격 차트·전적·출시 주기' },
    consensus: {
      name: '시장 기준선',
      role: '돈이 매긴 확률',
      basis: '예측시장·배당·옵션 등 돈이 걸린 시장. 없으면 쉼',
    },
    crow: { name: '까마귀', role: '다수가 놓친 위험', basis: '과열·쏠림 지표, 반대 근거' },
    replay: { name: '복기 · Claude Opus 5.5', role: '지난 채점에서 배우기', basis: '리그 채점 기록과 교훈 노트' },
  },
  consensusBasisNoBetting: '예측시장·옵션 등 돈이 걸린 시장. 없으면 쉼',
}

const en: ExtraDescriptionPack = {
  roleLabel: 'Role',
  basisLabel: 'Basis',
  noMarket: 'There is no market with money on this subject',
  seats: {
    divination: {
      name: 'Fortune',
      role: 'An entertainment reading',
      basis:
        "Date, hexagrams, tarot, runes, the subject's year and month pillars, Nine Star Ki directions for property. Does not look at market data",
    },
    sentiment: {
      name: 'Mood & narrative',
      role: 'Where public opinion is heading',
      basis: 'Topics and article tone visible on the web',
    },
    history: {
      name: 'History & patterns',
      role: 'Finding past runs that look like this one',
      basis: 'Price charts, records, release cycles',
    },
    consensus: {
      name: 'Market baseline',
      role: 'The probability money has priced',
      basis: 'Markets with money at stake: prediction markets, betting odds, options. Sits out if there is none',
    },
    crow: {
      name: 'Crow',
      role: 'The risk the crowd missed',
      basis: 'Overheating and crowding signals, the case against',
    },
    replay: {
      name: 'Review · Claude Opus 5.5',
      role: 'Learning from past grades',
      basis: 'League grading record and lesson notes',
    },
  },
  consensusBasisNoBetting: 'Markets with money at stake: prediction markets, options. Sits out if there is none',
}

const ja: ExtraDescriptionPack = {
  roleLabel: '役割',
  basisLabel: '判断の根拠',
  noMarket: 'この対象にはお金が動く市場がありません',
  seats: {
    divination: {
      name: '占い',
      role: '娯楽の占い',
      basis: '日付・卦・タロット・ルーン・対象の年柱と月柱、不動産は九星気学の方位。市場データは見ない',
    },
    sentiment: { name: '心理・ナラティブ', role: '世論の向き', basis: 'ウェブに出た話題・記事のトーン' },
    history: { name: '歴史・パターン', role: '過去の似た流れを探す', basis: '価格チャート・対戦成績・発売周期' },
    consensus: {
      name: '市場基準線',
      role: 'お金が付けた確率',
      basis: '予測市場・オッズ・オプションなどお金が動く市場。なければ休み',
    },
    crow: { name: 'カラス', role: '多数が見落としたリスク', basis: '過熱・偏りの指標、反対の根拠' },
    replay: { name: '復習 · Claude Opus 5.5', role: '過去の採点から学ぶ', basis: 'リーグの採点記録と教訓ノート' },
  },
  consensusBasisNoBetting: '予測市場・オプションなどお金が動く市場。なければ休み',
}

const zhTW: ExtraDescriptionPack = {
  roleLabel: '角色',
  basisLabel: '判斷依據',
  noMarket: '這個標的沒有押上真錢的市場',
  seats: {
    divination: {
      name: '占卜',
      role: '娛樂用占卜',
      basis: '日期、卦、塔羅、符文、對象的年柱與月柱，房地產看九星氣學方位。不看市場數據',
    },
    sentiment: { name: '心理・敘事', role: '輿論的方向', basis: '網路上可見的話題與報導語氣' },
    history: { name: '歷史・規律', role: '找和過去相似的走勢', basis: '價格圖表、戰績、發布週期' },
    consensus: {
      name: '市場基準線',
      role: '資金定出的機率',
      basis: '預測市場、賠率、選擇權等押上真錢的市場。沒有就休息',
    },
    crow: { name: '烏鴉', role: '多數人忽略的風險', basis: '過熱與偏斜指標、反方論據' },
    replay: { name: '覆盤 · Claude Opus 5.5', role: '從過去的評分學習', basis: '聯賽評分紀錄與教訓筆記' },
  },
  consensusBasisNoBetting: '預測市場、選擇權等押上真錢的市場。沒有就休息',
}

const fr: ExtraDescriptionPack = {
  roleLabel: 'Rôle',
  basisLabel: 'Fondement',
  noMarket: 'Aucun marché avec de l’argent en jeu n’existe pour ce sujet',
  seats: {
    divination: {
      name: 'Divination',
      role: 'Un tirage pour le jeu',
      basis:
        "Date, hexagrammes, tarot, runes, piliers année et mois du sujet, directions des neuf étoiles pour l'immobilier. Ne lit pas les données de marché",
    },
    sentiment: {
      name: 'Humeur et récit',
      role: 'La direction de l’opinion',
      basis: 'Sujets et ton des articles visibles sur le web',
    },
    history: {
      name: 'Histoire et motifs',
      role: 'Trouver des séries passées semblables',
      basis: 'Graphiques de prix, bilans, cycles de sortie',
    },
    consensus: {
      name: 'Référence de marché',
      role: 'La probabilité fixée par l’argent',
      basis: 'Marchés où l’argent est engagé : marchés prédictifs, cotes, options. Se tait s’il n’y en a pas',
    },
    crow: {
      name: 'Corbeau',
      role: 'Le risque que la foule a manqué',
      basis: 'Signaux de surchauffe et de déséquilibre, arguments contraires',
    },
    replay: {
      name: 'Revue · Claude Opus 5.5',
      role: 'Apprendre des notes passées',
      basis: 'Historique de notation de la ligue et notes de leçons',
    },
  },
  consensusBasisNoBetting: 'Marchés où l’argent est engagé : marchés prédictifs, options. Se tait s’il n’y en a pas',
}

const es: ExtraDescriptionPack = {
  roleLabel: 'Función',
  basisLabel: 'En qué se basa',
  noMarket: 'No hay un mercado con dinero en juego para este tema',
  seats: {
    divination: {
      name: 'Adivinación',
      role: 'Una lectura de entretenimiento',
      basis:
        'Fecha, hexagramas, tarot, runas, pilares de año y mes del sujeto, direcciones de las nueve estrellas para vivienda. No mira datos de mercado',
    },
    sentiment: {
      name: 'Ánimo y relato',
      role: 'Hacia dónde va la opinión',
      basis: 'Temas y tono de artículos visibles en la web',
    },
    history: {
      name: 'Historia y patrones',
      role: 'Buscar rachas pasadas parecidas',
      basis: 'Gráficos de precio, marcas, ciclos de lanzamiento',
    },
    consensus: {
      name: 'Línea de mercado',
      role: 'La probabilidad que puso el dinero',
      basis: 'Mercados con dinero en juego: mercados de predicción, cuotas, opciones. Si no hay, descansa',
    },
    crow: {
      name: 'Cuervo',
      role: 'El riesgo que la mayoría pasó por alto',
      basis: 'Señales de sobrecalentamiento y sesgo, argumentos en contra',
    },
    replay: {
      name: 'Repaso · Claude Opus 5.5',
      role: 'Aprender de las notas pasadas',
      basis: 'Historial de calificaciones de la liga y notas de lecciones',
    },
  },
  consensusBasisNoBetting: 'Mercados con dinero en juego: mercados de predicción, opciones. Si no hay, descansa',
}

const ar: ExtraDescriptionPack = {
  roleLabel: 'الدور',
  basisLabel: 'أساس الحكم',
  noMarket: 'لا توجد سوق فيها مال على هذا الموضوع',
  seats: {
    divination: {
      name: 'عرافة',
      role: 'قراءة للترفيه',
      basis:
        'التاريخ والهيكساغرام والتارو والرموز، وعمودا السنة والشهر للموضوع، واتجاهات النجوم التسع للعقارات. لا ينظر إلى بيانات السوق',
    },
    sentiment: {
      name: 'المزاج والسرد',
      role: 'اتجاه الرأي العام',
      basis: 'المواضيع ونبرة المقالات الظاهرة على الويب',
    },
    history: {
      name: 'التاريخ والأنماط',
      role: 'إيجاد مسارات ماضية شبيهة',
      basis: 'رسوم الأسعار والسجلات ودورات الإصدار',
    },
    consensus: {
      name: 'خط السوق المرجعي',
      role: 'الاحتمال الذي وضعه المال',
      basis: 'أسواق فيها مال: أسواق التنبؤ وأسعار المراهنة والخيارات. يستريح إن لم توجد',
    },
    crow: {
      name: 'غراب',
      role: 'الخطر الذي فات الأغلبية',
      basis: 'مؤشرات الحمى والانحياز، وحجج المعارضة',
    },
    replay: {
      name: 'مراجعة · Claude Opus 5.5',
      role: 'التعلم من التقييمات السابقة',
      basis: 'سجل تقييم الدوري ومذكرات الدروس',
    },
  },
  consensusBasisNoBetting: 'أسواق فيها مال: أسواق التنبؤ والخيارات. يستريح إن لم توجد',
}

const pt: ExtraDescriptionPack = {
  roleLabel: 'Papel',
  basisLabel: 'Base',
  noMarket: 'Não há mercado com dinheiro em jogo para este tema',
  seats: {
    divination: {
      name: 'Adivinhação',
      role: 'Uma leitura de entretenimento',
      basis:
        'Data, hexagramas, tarô, runas, pilares de ano e mês do sujeito, direções das nove estrelas para imóveis. Não olha dados de mercado',
    },
    sentiment: {
      name: 'Humor e narrativa',
      role: 'Para onde vai a opinião',
      basis: 'Temas e tom de matérias visíveis na web',
    },
    history: {
      name: 'História e padrões',
      role: 'Achar sequências passadas parecidas',
      basis: 'Gráficos de preço, retrospectos, ciclos de lançamento',
    },
    consensus: {
      name: 'Linha de mercado',
      role: 'A probabilidade que o dinheiro precificou',
      basis: 'Mercados com dinheiro em jogo: mercados de previsão, odds, opções. Sem mercado, descansa',
    },
    crow: {
      name: 'Corvo',
      role: 'O risco que a maioria deixou passar',
      basis: 'Sinais de superaquecimento e viés, argumentos contrários',
    },
    replay: {
      name: 'Revisão · Claude Opus 5.5',
      role: 'Aprender com as notas passadas',
      basis: 'Histórico de notas da liga e notas de lições',
    },
  },
  consensusBasisNoBetting: 'Mercados com dinheiro em jogo: mercados de previsão, opções. Sem mercado, descansa',
}

const PACKS: Record<LeagueLocale, ExtraDescriptionPack> = {
  en,
  ko,
  ja,
  'zh-TW': zhTW,
  fr,
  ar,
  es,
  pt,
}

export function extraDescriptionPack(locale: LeagueLocale): ExtraDescriptionPack {
  return PACKS[locale] ?? en
}

export function extraSeatDescription(
  locale: LeagueLocale,
  seatId: ExtraSeatId,
  category?: string | null,
): ExtraSeatDescription {
  const pack = extraDescriptionPack(locale)
  const seat = pack.seats[seatId]
  if (seatId === 'consensus' && (isSportsLedgerCategory(category) || isPoliticsLedgerCategory(category))) {
    return { ...seat, basis: pack.consensusBasisNoBetting }
  }
  return seat
}

export function extraNoMarketLine(locale: LeagueLocale): string {
  return extraDescriptionPack(locale).noMarket
}
