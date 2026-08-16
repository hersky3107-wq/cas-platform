import type { DirectionTally } from '../card-types'
import type { LeagueLocale } from './locales'

export type LeagueDirectionWord = 'up' | 'down' | 'flat'

/**
 * AI Prediction League — CHROME dictionary (Layer A).
 *
 * Every user-facing STRING the card renders lives here, per locale. This is
 * the ONLY place a translated sentence gets assembled — `lib/league/compliance.ts`
 * calls into a `LeagueUiPack` rather than hard-coding English, so a locale
 * cannot skip the regulatory phrasing/disclaimer by omission (there is no
 * "default English fallback" for the compliance-critical fields; every real
 * locale below fills them in explicitly).
 *
 * WHAT IS NOT HERE (and never will be, in this pass): `reasoning_snippet`
 * (a model's own free-text output) and any other prediction DATA
 * (direction/probability/model list membership). Those are language-neutral
 * facts, not chrome — see `lib/league/card-aggregate.ts`. Translating model
 * reasoning is a separate, explicitly-deferred feature (would mean
 * machine-translating up to ~20+ snippets per view, per language, per
 * request — a real cost/latency problem, not just an i18n one).
 */
export type LeagueUiPack = {
  direction: {
    /** Short badge word per model row, e.g. "UP". */
    badge: Record<LeagueDirectionWord, string>
    noCallBadge: string
    /** Lowercase word used inside a tally sentence, e.g. "3 up". */
    tally: Record<LeagueDirectionWord, string>
    noCallTally: string
  }
  headline: {
    majority: (majorityCount: number, totalModels: number, direction: LeagueDirectionWord, confidencePct: number | null) => string
    allAbstain: (totalModels: number) => string
    split: (respondedModels: number, totalModels: number) => string
    none: string
  }
  /** e.g. "US: 3 up · 1 down · 1 no call" — `label` (e.g. "US"/"Premier") is passed through untranslated (a proper-noun-ish group name). */
  groupTallyLine: (label: string, tally: DirectionTally) => string
  disclaimer: { short: string; long: string }
  hitRate: { pending: string; pct: (pct: number) => string }
  modelList: {
    title: (count: number) => string
    tierTab: string
    campTab: string
    empty: string
    correct: string
    missed: string
  }
  gating: {
    /** Shown (localized) when JurisdictionGate hides a category for this user. */
    unavailable: string
    /** ToS-style note: users must use their real jurisdiction. */
    tosNote: string
  }
  languageToggleLabel: string
}

const en: LeagueUiPack = {
  direction: {
    badge: { up: 'UP', down: 'DOWN', flat: 'FLAT' },
    noCallBadge: 'NO CALL',
    tally: { up: 'up', down: 'down', flat: 'flat' },
    noCallTally: 'no call',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'lean UP', down: 'lean DOWN', flat: 'lean FLAT' }[dir]
      const suffix = conf !== null ? ` · ${Math.round(conf)}% avg confidence` : ''
      return `${count} of ${total} AI models ${word}${suffix}`
    },
    allAbstain: (total) => `All ${total} AI models abstained on this round`,
    split: (responded, total) => `${responded} of ${total} AI models are split — no clear lean`,
    none: 'No AI models have reported for this round yet',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} up`)
    if (tally.down) parts.push(`${tally.down} down`)
    if (tally.flat) parts.push(`${tally.flat} flat`)
    if (tally.abstain) parts.push(`${tally.abstain} no call`)
    return `${label}: ${parts.length ? parts.join(' · ') : 'no responses yet'}`
  },
  disclaimer: {
    short: 'Info only — not investment advice. You are responsible for your own decisions.',
    long: 'These are AI model opinions shown for information and entertainment purposes only. They are not investment, financial, legal, or professional advice, and no model here is a licensed advisor. Markets are unpredictable and AI models can be — and often are — wrong. You are solely responsible for any decision you make.',
  },
  hitRate: { pending: 'Hit rate: pending', pct: (pct) => `${pct}% hit rate` },
  modelList: {
    title: (n) => `Models (${n})`,
    tierTab: 'Tier',
    campTab: 'Camp',
    empty: 'No models have reported yet.',
    correct: 'Correct',
    missed: 'Missed',
  },
  gating: {
    unavailable: 'This prediction category isn\u2019t available in your region yet.',
    tosNote: 'Availability is based on your account\u2019s declared country and detected location. You must use your real jurisdiction \u2014 attempting to bypass this (e.g. via VPN) shifts responsibility for any resulting misuse to you.',
  },
  languageToggleLabel: 'Language',
}

const ko: LeagueUiPack = {
  direction: {
    badge: { up: '상승', down: '하락', flat: '보합' },
    noCallBadge: '의견 없음',
    tally: { up: '상승', down: '하락', flat: '보합' },
    noCallTally: '의견 없음',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: '상승', down: '하락', flat: '보합' }[dir]
      const suffix = conf !== null ? ` · 평균 신뢰도 ${Math.round(conf)}%` : ''
      return `AI 모델 ${total}개 중 ${count}개가 ${word}에 무게를 둠${suffix}`
    },
    allAbstain: (total) => `AI 모델 ${total}개 전원이 이번 라운드 의견을 유보했습니다`,
    split: (responded, total) => `AI 모델 ${total}개 중 ${responded}개가 의견을 냈지만 방향이 갈립니다 — 뚜렷한 우세 없음`,
    none: '아직 이번 라운드에 응답한 AI 모델이 없습니다',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`상승 ${tally.up}`)
    if (tally.down) parts.push(`하락 ${tally.down}`)
    if (tally.flat) parts.push(`보합 ${tally.flat}`)
    if (tally.abstain) parts.push(`의견없음 ${tally.abstain}`)
    return `${label}: ${parts.length ? parts.join(' · ') : '아직 응답 없음'}`
  },
  disclaimer: {
    short: '정보 제공 목적일 뿐 투자 조언이 아닙니다. 모든 결정의 책임은 본인에게 있습니다.',
    long: '본 콘텐츠는 여러 AI 모델의 의견을 정보 및 오락 목적으로 제공하는 것이며, 투자·금융·법률·전문 자문이 아닙니다. 여기 등장하는 어떤 모델도 인가받은 자문가가 아닙니다. 시장은 예측할 수 없으며 AI 모델의 예측은 자주, 그리고 크게 틀릴 수 있습니다. 이를 근거로 내리는 모든 결정의 책임은 전적으로 본인에게 있습니다.',
  },
  hitRate: { pending: '적중률 집계 중', pct: (pct) => `적중률 ${pct}%` },
  modelList: {
    title: (n) => `모델 (${n}개)`,
    tierTab: '티어',
    campTab: '진영',
    empty: '아직 응답한 모델이 없습니다.',
    correct: '적중',
    missed: '실패',
  },
  gating: {
    unavailable: '이 예측 카테고리는 아직 회원님의 지역에서 제공되지 않습니다.',
    tosNote: '노출 여부는 계정에 등록된 국가와 감지된 접속 위치를 기준으로 결정됩니다. 반드시 실제 관할 지역을 사용해야 하며, VPN 등으로 이를 우회하려는 시도로 발생하는 문제의 책임은 이용자 본인에게 있습니다.',
  },
  languageToggleLabel: '언어',
}

const ja: LeagueUiPack = {
  direction: {
    badge: { up: '上昇', down: '下落', flat: '横ばい' },
    noCallBadge: '判断なし',
    tally: { up: '上昇', down: '下落', flat: '横ばい' },
    noCallTally: '判断なし',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: '上昇', down: '下落', flat: '横ばい' }[dir]
      const suffix = conf !== null ? `・平均確信度${Math.round(conf)}%` : ''
      return `AIモデル${total}体中${count}体が${word}に傾いています${suffix}`
    },
    allAbstain: (total) => `AIモデル${total}体全てが今回の判断を保留しました`,
    split: (responded, total) => `AIモデル${total}体中${responded}体が回答しましたが意見が分かれ、明確な優勢はありません`,
    none: 'このラウンドにはまだ回答したAIモデルがありません',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`上昇${tally.up}`)
    if (tally.down) parts.push(`下落${tally.down}`)
    if (tally.flat) parts.push(`横ばい${tally.flat}`)
    if (tally.abstain) parts.push(`判断なし${tally.abstain}`)
    return `${label}：${parts.length ? parts.join('・') : 'まだ回答なし'}`
  },
  disclaimer: {
    short: '情報提供のみを目的としており、投資助言ではありません。ご自身の判断と責任でご利用ください。',
    long: 'この内容は複数のAIモデルの見解を情報提供・娯楽目的で示したものであり、投資・金融・法律・専門的な助言ではありません。ここに登場するモデルはいずれも認可を受けたアドバイザーではありません。市場は予測不可能であり、AIモデルの予測は誤ることが多々あります。これに基づく判断の責任はすべてご自身が負うものとします。',
  },
  hitRate: { pending: '的中率：集計待ち', pct: (pct) => `的中率${pct}%` },
  modelList: {
    title: (n) => `モデル（${n}）`,
    tierTab: 'ティア',
    campTab: '陣営',
    empty: 'まだ回答したモデルがありません。',
    correct: '的中',
    missed: '外れ',
  },
  gating: {
    unavailable: 'この予測カテゴリーは、お住まいの地域ではまだご利用いただけません。',
    tosNote: '表示可否はアカウントに登録された国と検出された接続地域に基づいて判定されます。実際の管轄地域を使用してください。VPN等でこれを回避しようとした場合に生じる問題の責任はご自身が負うものとします。',
  },
  languageToggleLabel: '言語',
}

const zhTW: LeagueUiPack = {
  direction: {
    badge: { up: '看漲', down: '看跌', flat: '持平' },
    noCallBadge: '未表態',
    tally: { up: '看漲', down: '看跌', flat: '持平' },
    noCallTally: '未表態',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: '看漲', down: '看跌', flat: '持平' }[dir]
      const suffix = conf !== null ? `・平均信心指數 ${Math.round(conf)}%` : ''
      return `${total} 個 AI 模型中有 ${count} 個傾向${word}${suffix}`
    },
    allAbstain: (total) => `全部 ${total} 個 AI 模型本輪均未表態`,
    split: (responded, total) => `${total} 個 AI 模型中有 ${responded} 個給出意見，但看法分歧，沒有明顯多數`,
    none: '本輪目前尚無 AI 模型回應',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`看漲 ${tally.up}`)
    if (tally.down) parts.push(`看跌 ${tally.down}`)
    if (tally.flat) parts.push(`持平 ${tally.flat}`)
    if (tally.abstain) parts.push(`未表態 ${tally.abstain}`)
    return `${label}：${parts.length ? parts.join('・') : '尚無回應'}`
  },
  disclaimer: {
    short: '僅供參考，非投資建議。所有決定的責任由您自行承擔。',
    long: '本內容為多個 AI 模型的意見，僅供資訊與娛樂用途，並非投資、財務、法律或專業建議；此處任何模型皆非持牌顧問。市場無法預測，AI 模型的判斷經常出錯。您必須自行承擔依此做出之任何決定的全部責任。',
  },
  hitRate: { pending: '命中率：統計中', pct: (pct) => `命中率 ${pct}%` },
  modelList: {
    title: (n) => `模型（${n}）`,
    tierTab: '級別',
    campTab: '陣營',
    empty: '目前尚無模型回應。',
    correct: '命中',
    missed: '未命中',
  },
  gating: {
    unavailable: '此預測類別在您所在地區尚未開放。',
    tosNote: '是否顯示取決於您帳號登記的國家與偵測到的所在位置。您必須使用真實所在地區；若透過 VPN 等方式規避此限制，由此產生的任何後果由您自行承擔。',
  },
  languageToggleLabel: '語言',
}

const fr: LeagueUiPack = {
  direction: {
    badge: { up: 'HAUSSE', down: 'BAISSE', flat: 'STABLE' },
    noCallBadge: 'SANS AVIS',
    tally: { up: 'hausse', down: 'baisse', flat: 'stable' },
    noCallTally: 'sans avis',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'à la hausse', down: 'à la baisse', flat: 'stables' }[dir]
      const suffix = conf !== null ? ` · confiance moyenne de ${Math.round(conf)}%` : ''
      return `${count} modèles IA sur ${total} penchent ${word}${suffix}`
    },
    allAbstain: (total) => `Les ${total} modèles IA se sont tous abstenus pour ce tour`,
    split: (responded, total) => `${responded} modèles IA sur ${total} ont répondu, mais les avis sont partagés — aucune tendance claire`,
    none: 'Aucun modèle IA n\u2019a encore répondu pour ce tour',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} hausse`)
    if (tally.down) parts.push(`${tally.down} baisse`)
    if (tally.flat) parts.push(`${tally.flat} stable`)
    if (tally.abstain) parts.push(`${tally.abstain} sans avis`)
    return `${label} : ${parts.length ? parts.join(' · ') : 'aucune réponse pour le moment'}`
  },
  disclaimer: {
    short: 'Information uniquement, ceci n\u2019est pas un conseil en investissement. Vous êtes seul responsable de vos décisions.',
    long: 'Ce contenu présente les avis de plusieurs modèles d\u2019IA à titre purement informatif et de divertissement. Il ne s\u2019agit pas d\u2019un conseil en investissement, financier, juridique ou professionnel, et aucun modèle ici n\u2019est un conseiller agréé. Les marchés sont imprévisibles et les modèles d\u2019IA peuvent se tromper, et se trompent souvent. Vous assumez l\u2019entière responsabilité de toute décision prise sur cette base.',
  },
  hitRate: { pending: 'Taux de réussite : en attente', pct: (pct) => `${pct}% de réussite` },
  modelList: {
    title: (n) => `Modèles (${n})`,
    tierTab: 'Niveau',
    campTab: 'Camp',
    empty: 'Aucun modèle n\u2019a encore répondu.',
    correct: 'Correct',
    missed: 'Manqué',
  },
  gating: {
    unavailable: 'Cette catégorie de prédiction n\u2019est pas encore disponible dans votre région.',
    tosNote: 'La disponibilité dépend du pays déclaré sur votre compte et de votre localisation détectée. Vous devez utiliser votre véritable juridiction \u2014 toute tentative de contournement (par VPN, par exemple) vous rend responsable des conséquences.',
  },
  languageToggleLabel: 'Langue',
}

const es: LeagueUiPack = {
  direction: {
    badge: { up: 'SUBE', down: 'BAJA', flat: 'ESTABLE' },
    noCallBadge: 'SIN OPINIÓN',
    tally: { up: 'sube', down: 'baja', flat: 'estable' },
    noCallTally: 'sin opinión',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'a la suba', down: 'a la baja', flat: 'estable' }[dir]
      const suffix = conf !== null ? ` · confianza media del ${Math.round(conf)}%` : ''
      return `${count} de ${total} modelos de IA se inclinan ${word}${suffix}`
    },
    allAbstain: (total) => `Los ${total} modelos de IA se abstuvieron en esta ronda`,
    split: (responded, total) => `${responded} de ${total} modelos de IA respondieron, pero están divididos — sin tendencia clara`,
    none: 'Todavía ningún modelo de IA respondió en esta ronda',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} sube`)
    if (tally.down) parts.push(`${tally.down} baja`)
    if (tally.flat) parts.push(`${tally.flat} estable`)
    if (tally.abstain) parts.push(`${tally.abstain} sin opinión`)
    return `${label}: ${parts.length ? parts.join(' · ') : 'sin respuestas todavía'}`
  },
  disclaimer: {
    short: 'Solo información, no es asesoramiento de inversión. Usted es responsable de sus propias decisiones.',
    long: 'Este contenido muestra opiniones de varios modelos de IA con fines informativos y de entretenimiento únicamente. No constituye asesoramiento de inversión, financiero, legal ni profesional, y ninguno de estos modelos es un asesor autorizado. Los mercados son impredecibles y los modelos de IA pueden equivocarse, y a menudo lo hacen. Usted es el único responsable de cualquier decisión que tome con base en esta información.',
  },
  hitRate: { pending: 'Tasa de acierto: pendiente', pct: (pct) => `${pct}% de acierto` },
  modelList: {
    title: (n) => `Modelos (${n})`,
    tierTab: 'Nivel',
    campTab: 'Bloque',
    empty: 'Todavía ningún modelo ha respondido.',
    correct: 'Acertó',
    missed: 'Falló',
  },
  gating: {
    unavailable: 'Esta categoría de predicción todavía no está disponible en tu región.',
    tosNote: 'La disponibilidad depende del país declarado en tu cuenta y de tu ubicación detectada. Debes usar tu jurisdicción real: si intentas evadir esto (por ejemplo, con una VPN), asumes la responsabilidad de las consecuencias.',
  },
  languageToggleLabel: 'Idioma',
}

const ar: LeagueUiPack = {
  direction: {
    badge: { up: 'صعود', down: 'هبوط', flat: 'استقرار' },
    noCallBadge: 'بلا رأي',
    tally: { up: 'صعود', down: 'هبوط', flat: 'استقرار' },
    noCallTally: 'بلا رأي',
  },
  headline: {
    majority: (count, total, dir, conf) => {
      const word = { up: 'الصعود', down: 'الهبوط', flat: 'الاستقرار' }[dir]
      const suffix = conf !== null ? ` · متوسط الثقة ${Math.round(conf)}%` : ''
      return `${count} من أصل ${total} من نماذج الذكاء الاصطناعي يميل رأيها إلى ${word}${suffix}`
    },
    allAbstain: (total) => `امتنعت جميع نماذج الذكاء الاصطناعي البالغ عددها ${total} عن إبداء رأي في هذه الجولة`,
    split: (responded, total) => `أجاب ${responded} من أصل ${total} من نماذج الذكاء الاصطناعي، لكن الآراء منقسمة — لا يوجد اتجاه واضح`,
    none: 'لم يستجب أي نموذج ذكاء اصطناعي لهذه الجولة بعد',
  },
  groupTallyLine: (label, tally) => {
    const parts: string[] = []
    if (tally.up) parts.push(`${tally.up} صعود`)
    if (tally.down) parts.push(`${tally.down} هبوط`)
    if (tally.flat) parts.push(`${tally.flat} استقرار`)
    if (tally.abstain) parts.push(`${tally.abstain} بلا رأي`)
    return `${label}: ${parts.length ? parts.join(' · ') : 'لا توجد إجابات بعد'}`
  },
  disclaimer: {
    short: 'لأغراض المعلومات فقط، وليست نصيحة استثمارية. أنت المسؤول عن قراراتك الخاصة.',
    long: 'يعرض هذا المحتوى آراء عدة نماذج ذكاء اصطناعي لأغراض المعلومات والترفيه فقط. وهو لا يمثل نصيحة استثمارية أو مالية أو قانونية أو مهنية، وليس أي نموذج هنا مستشارًا مرخصًا. الأسواق غير قابلة للتنبؤ، وقد تخطئ نماذج الذكاء الاصطناعي، بل وتخطئ كثيرًا. أنت وحدك المسؤول عن أي قرار تتخذه بناءً على ذلك.',
  },
  hitRate: { pending: 'معدل الإصابة: قيد الحساب', pct: (pct) => `معدل الإصابة ${pct}%` },
  modelList: {
    title: (n) => `النماذج (${n})`,
    tierTab: 'الفئة',
    campTab: 'المعسكر',
    empty: 'لم يستجب أي نموذج بعد.',
    correct: 'إصابة',
    missed: 'خطأ',
  },
  gating: {
    unavailable: 'فئة التوقعات هذه غير متاحة بعد في منطقتك.',
    tosNote: 'يعتمد الظهور على الدولة المسجَّلة في حسابك والموقع المكتشَف لاتصالك. يجب عليك استخدام نطاقك القضائي الحقيقي؛ وإذا حاولت تجاوز ذلك (عبر VPN مثلاً) فإنك تتحمل مسؤولية أي نتائج تترتب على ذلك.',
  },
  languageToggleLabel: 'اللغة',
}

/** Structural stub — Brazil scope is intentionally deferred. Spreads English so the shape is always complete. */
const pt: LeagueUiPack = { ...en }

export const LEAGUE_UI: Record<LeagueLocale, LeagueUiPack> = { en, ko, ja, 'zh-TW': zhTW, fr, ar, es, pt }

export function getLeagueUiPack(locale: LeagueLocale): LeagueUiPack {
  return LEAGUE_UI[locale] ?? LEAGUE_UI.en
}
