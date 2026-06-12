/** SYNOD UI strings — use `getSynodUiPack(locale)`; fallback English. */

export const SYNOD_LOCALES = ['en', 'ko', 'ja', 'zh-TW', 'fr', 'ar', 'es', 'pt'] as const

export type SynodLocale = (typeof SYNOD_LOCALES)[number]

export type SynodUiPack = {
  // Action tags (API enums AGREE/CHALLENGE/SUPPLEMENT/REFRAME)
  agree: string
  challenge: string
  supplement: string
  reframe: string
  // Roles
  redTeam: string
  facilitator: string
  /** Translated title only; keep Claude sign-off in every locale. */
  finalSynthesis: string
  minorityReport: string
  // Facilitator section
  consensusInline: string
  consensusHeading: string
  openIssues: string
  next: string
  noneYet: string
  none: string
  // Gauge
  finalScore: string
  consensus: string
  threshold: string
  // Round / phase
  opening: string
  round: (n: number) => string
  openingStatements: string
  deliberating: string
  verdictDeliberating: string
  verdictWriting: string
  // Idle screen
  headerTagline: string
  placeholder: string
  easy: string
  easyDesc: string
  expert: string
  expertDesc: string
  convene: string
  // Errors
  insufficientCredits: string
  requestFailed: (status: number) => string
  malformedResponse: string
  networkError: string
  noSessionId: string
  progressSaved: string
  // Misc
  ms: string
}

export const SYNOD_UI: Record<SynodLocale, SynodUiPack> = {
  en: {
    agree: 'Agree',
    challenge: 'Challenge',
    supplement: 'Supplement',
    reframe: 'Reframe',
    redTeam: 'Red team',
    facilitator: 'Facilitator',
    finalSynthesis: 'Final synthesis — Claude Opus 4.8',
    minorityReport: 'Minority report',
    consensusInline: 'consensus',
    consensusHeading: 'Consensus',
    openIssues: 'Open issues',
    next: 'Next',
    noneYet: 'None yet.',
    none: 'None.',
    finalScore: 'Final score',
    consensus: 'Consensus',
    threshold: 'threshold',
    opening: 'Opening',
    round: (n) => `Round ${n}`,
    openingStatements: 'Opening statements',
    deliberating: 'Deliberating',
    verdictDeliberating: 'Verdict chair deliberating…',
    verdictWriting: 'Claude Opus 4.8 is writing the verdict…',
    headerTagline: 'Six AIs deliberate in series toward the best consensus answer.',
    placeholder: 'Ask a question worth deliberating…',
    easy: 'Easy',
    easyDesc: 'Simple & quick · anyone can follow',
    expert: 'Expert',
    expertDesc: 'Deeper & more technical',
    convene: 'Convene SYNOD',
    insufficientCredits: 'Insufficient credits',
    requestFailed: (status) => `Request failed (${status})`,
    malformedResponse: 'Malformed response',
    networkError: 'Network error',
    noSessionId: 'No session id',
    progressSaved: 'Progress saved — reload to resume.',
    ms: 'ms',
  },
  ko: {
    agree: '동의',
    challenge: '반박',
    supplement: '보충',
    reframe: '재구성',
    redTeam: '레드팀',
    facilitator: '진행자',
    finalSynthesis: '최종 종합 — Claude Opus 4.8',
    minorityReport: '소수 의견',
    consensusInline: '합의',
    consensusHeading: '합의',
    openIssues: '미해결 쟁점',
    next: '다음',
    noneYet: '아직 없습니다.',
    none: '없습니다.',
    finalScore: '최종 점수',
    consensus: '합의',
    threshold: '기준선',
    opening: '오프닝',
    round: (n) => `${n}라운드`,
    openingStatements: '오프닝 발언',
    deliberating: '토론 중',
    verdictDeliberating: '판정의장 심의 중…',
    verdictWriting: 'Claude Opus 4.8이 판정문을 작성 중…',
    headerTagline: '여섯 AI가 차례로 토론해 최선의 합의에 도달합니다.',
    placeholder: '토론할 만한 질문을 입력하세요…',
    easy: '일반',
    easyDesc: '쉽고 빠르게 · 누구나 이해',
    expert: '전문가',
    expertDesc: '더 깊고 전문적으로',
    convene: 'SYNOD 시작',
    insufficientCredits: '크레딧이 부족합니다',
    requestFailed: (status) => `요청 실패 (${status})`,
    malformedResponse: '잘못된 응답',
    networkError: '네트워크 오류',
    noSessionId: '세션 ID가 없습니다',
    progressSaved: '진행 상황이 저장되었습니다 — 새로고침하면 이어갈 수 있습니다.',
    ms: 'ms',
  },
  ja: {
    agree: '同意',
    challenge: '反論',
    supplement: '補足',
    reframe: '再構成',
    redTeam: 'レッドチーム',
    facilitator: 'ファシリテーター',
    finalSynthesis: '最終総括 — Claude Opus 4.8',
    minorityReport: '少数意見',
    consensusInline: '合意',
    consensusHeading: '合意',
    openIssues: '未解決の論点',
    next: '次',
    noneYet: 'まだありません。',
    none: 'なし。',
    finalScore: '最終スコア',
    consensus: '合意',
    threshold: '基準',
    opening: 'オープニング',
    round: (n) => `ラウンド ${n}`,
    openingStatements: 'オープニング発言',
    deliberating: '審議中',
    verdictDeliberating: '判定議長が審議中…',
    verdictWriting: 'Claude Opus 4.8 が判定文を執筆中…',
    headerTagline: '6つのAIが順番に審議し、最良の合意に至ります。',
    placeholder: '審議に値する質問を入力してください…',
    easy: '一般',
    easyDesc: 'わかりやすく · 誰でも理解できる',
    expert: '専門家',
    expertDesc: 'より深く · 専門的に',
    convene: 'SYNODを開始',
    insufficientCredits: 'クレジットが不足しています',
    requestFailed: (status) => `リクエスト失敗 (${status})`,
    malformedResponse: '不正な応答',
    networkError: 'ネットワークエラー',
    noSessionId: 'セッションIDがありません',
    progressSaved: '進行状況を保存しました — 再読み込みで再開できます。',
    ms: 'ms',
  },
  'zh-TW': {
    agree: '同意',
    challenge: '質疑',
    supplement: '補充',
    reframe: '重構',
    redTeam: '紅隊',
    facilitator: '主持人',
    finalSynthesis: '最終綜合 — Claude Opus 4.8',
    minorityReport: '少數意見',
    consensusInline: '共識',
    consensusHeading: '共識',
    openIssues: '待解議題',
    next: '下一步',
    noneYet: '尚無。',
    none: '無。',
    finalScore: '最終分數',
    consensus: '共識',
    threshold: '門檻',
    opening: '開場',
    round: (n) => `第 ${n} 輪`,
    openingStatements: '開場陳述',
    deliberating: '審議中',
    verdictDeliberating: '裁決主席審議中…',
    verdictWriting: 'Claude Opus 4.8 正在撰寫裁決…',
    headerTagline: '六個 AI 依序審議，力求達成最佳共識。',
    placeholder: '輸入值得審議的問題…',
    easy: '一般',
    easyDesc: '簡明快速 · 人人都能懂',
    expert: '專家',
    expertDesc: '更深入 · 更專業',
    convene: '召開 SYNOD',
    insufficientCredits: '點數不足',
    requestFailed: (status) => `請求失敗 (${status})`,
    malformedResponse: '回應格式錯誤',
    networkError: '網路錯誤',
    noSessionId: '缺少工作階段 ID',
    progressSaved: '進度已儲存 — 重新載入即可繼續。',
    ms: 'ms',
  },
  fr: {
    agree: 'Accord',
    challenge: 'Contestation',
    supplement: 'Complément',
    reframe: 'Recadrage',
    redTeam: 'Équipe rouge',
    facilitator: 'Facilitateur',
    finalSynthesis: 'Synthèse finale — Claude Opus 4.8',
    minorityReport: 'Rapport minoritaire',
    consensusInline: 'consensus',
    consensusHeading: 'Consensus',
    openIssues: 'Points ouverts',
    next: 'Suite',
    noneYet: 'Rien pour l’instant.',
    none: 'Aucun.',
    finalScore: 'Score final',
    consensus: 'Consensus',
    threshold: 'seuil',
    opening: 'Ouverture',
    round: (n) => `Tour ${n}`,
    openingStatements: 'Prises de parole initiales',
    deliberating: 'Délibération',
    verdictDeliberating: 'Le président du verdict délibère…',
    verdictWriting: 'Claude Opus 4.8 rédige le verdict…',
    headerTagline: 'Six IA délibèrent à tour de rôle pour atteindre le meilleur consensus.',
    placeholder: 'Posez une question qui mérite d’être débattue…',
    easy: 'Facile',
    easyDesc: 'Simple et rapide · accessible à tous',
    expert: 'Expert',
    expertDesc: 'Plus approfondi · plus technique',
    convene: 'Lancer SYNOD',
    insufficientCredits: 'Crédits insuffisants',
    requestFailed: (status) => `Échec de la requête (${status})`,
    malformedResponse: 'Réponse incorrecte',
    networkError: 'Erreur réseau',
    noSessionId: 'Identifiant de session manquant',
    progressSaved: 'Progression enregistrée — rechargez pour reprendre.',
    ms: 'ms',
  },
  ar: {
    agree: 'موافقة',
    challenge: 'اعتراض',
    supplement: 'تكملة',
    reframe: 'إعادة صياغة',
    redTeam: 'الفريق الأحمر',
    facilitator: 'الميسّر',
    finalSynthesis: 'التركيب النهائي — Claude Opus 4.8',
    minorityReport: 'تقرير الأقلية',
    consensusInline: 'التوافق',
    consensusHeading: 'التوافق',
    openIssues: 'قضايا مفتوحة',
    next: 'التالي',
    noneYet: 'لا شيء بعد.',
    none: 'لا يوجد.',
    finalScore: 'النتيجة النهائية',
    consensus: 'التوافق',
    threshold: 'العتبة',
    opening: 'الافتتاح',
    round: (n) => `الجولة ${n}`,
    openingStatements: 'بيانات الافتتاح',
    deliberating: 'جاري التداول',
    verdictDeliberating: 'رئيس الحكم يتداول…',
    verdictWriting: 'Claude Opus 4.8 يكتب الحكم…',
    headerTagline: 'ستة نماذج ذكاء اصطناعي تتداول بالتتابع للوصول إلى أفضل توافق.',
    placeholder: 'اطرح سؤالاً يستحق النقاش…',
    easy: 'عام',
    easyDesc: 'بسيط وسريع · يفهمه الجميع',
    expert: 'خبير',
    expertDesc: 'أعمق · أكثر تخصصاً',
    convene: 'ابدأ SYNOD',
    insufficientCredits: 'الرصيد غير كافٍ',
    requestFailed: (status) => `فشل الطلب (${status})`,
    malformedResponse: 'استجابة غير صالحة',
    networkError: 'خطأ في الشبكة',
    noSessionId: 'لا يوجد معرّف جلسة',
    progressSaved: 'تم حفظ التقدّم — أعد التحميل للمتابعة.',
    ms: 'ms',
  },
  es: {
    agree: 'De acuerdo',
    challenge: 'Impugnación',
    supplement: 'Complemento',
    reframe: 'Reencuadre',
    redTeam: 'Equipo rojo',
    facilitator: 'Facilitador',
    finalSynthesis: 'Síntesis final — Claude Opus 4.8',
    minorityReport: 'Informe minoritario',
    consensusInline: 'consenso',
    consensusHeading: 'Consenso',
    openIssues: 'Puntos abiertos',
    next: 'Siguiente',
    noneYet: 'Nada aún.',
    none: 'Ninguno.',
    finalScore: 'Puntuación final',
    consensus: 'Consenso',
    threshold: 'umbral',
    opening: 'Apertura',
    round: (n) => `Ronda ${n}`,
    openingStatements: 'Declaraciones iniciales',
    deliberating: 'Deliberando',
    verdictDeliberating: 'El presidente del veredicto delibera…',
    verdictWriting: 'Claude Opus 4.8 está redactando el veredicto…',
    headerTagline: 'Seis IA deliberan en serie para alcanzar el mejor consenso.',
    placeholder: 'Haz una pregunta que merezca deliberarse…',
    easy: 'Fácil',
    easyDesc: 'Simple y rápido · para todos',
    expert: 'Experto',
    expertDesc: 'Más profundo · más técnico',
    convene: 'Iniciar SYNOD',
    insufficientCredits: 'Créditos insuficientes',
    requestFailed: (status) => `Error en la solicitud (${status})`,
    malformedResponse: 'Respuesta incorrecta',
    networkError: 'Error de red',
    noSessionId: 'Sin ID de sesión',
    progressSaved: 'Progreso guardado — recarga para continuar.',
    ms: 'ms',
  },
  pt: {
    agree: 'Concordo',
    challenge: 'Contestação',
    supplement: 'Complemento',
    reframe: 'Reenquadramento',
    redTeam: 'Equipe vermelha',
    facilitator: 'Facilitador',
    finalSynthesis: 'Síntese final — Claude Opus 4.8',
    minorityReport: 'Relatório minoritário',
    consensusInline: 'consenso',
    consensusHeading: 'Consenso',
    openIssues: 'Pontos em aberto',
    next: 'Próximo',
    noneYet: 'Nada ainda.',
    none: 'Nenhum.',
    finalScore: 'Pontuação final',
    consensus: 'Consenso',
    threshold: 'limiar',
    opening: 'Abertura',
    round: (n) => `Rodada ${n}`,
    openingStatements: 'Declarações iniciais',
    deliberating: 'Deliberando',
    verdictDeliberating: 'O presidente do veredito está deliberando…',
    verdictWriting: 'Claude Opus 4.8 está redigindo o veredito…',
    headerTagline: 'Seis IAs deliberam em série para chegar ao melhor consenso.',
    placeholder: 'Faça uma pergunta que valha a pena deliberar…',
    easy: 'Fácil',
    easyDesc: 'Simples e rápido · qualquer um entende',
    expert: 'Especialista',
    expertDesc: 'Mais profundo · mais técnico',
    convene: 'Iniciar SYNOD',
    insufficientCredits: 'Créditos insuficientes',
    requestFailed: (status) => `Falha na solicitação (${status})`,
    malformedResponse: 'Resposta inválida',
    networkError: 'Erro de rede',
    noSessionId: 'Sem ID de sessão',
    progressSaved: 'Progresso salvo — recarregue para retomar.',
    ms: 'ms',
  },
}

const ACTION_TAG_KEYS: Record<string, keyof Pick<SynodUiPack, 'agree' | 'challenge' | 'supplement' | 'reframe'>> = {
  AGREE: 'agree',
  CHALLENGE: 'challenge',
  SUPPLEMENT: 'supplement',
  REFRAME: 'reframe',
}

/** Localized label pack for a resolved locale; falls back to English. */
export function getSynodUiPack(locale: SynodLocale): SynodUiPack {
  return SYNOD_UI[locale] ?? SYNOD_UI.en
}

/** Map API action-tag enums to localized UI labels. */
export function localizeActionTag(tag: string, locale: SynodLocale): string {
  const key = ACTION_TAG_KEYS[tag.toUpperCase()]
  if (!key) return tag
  return getSynodUiPack(locale)[key]
}

function isSynodLocale(value: string): value is SynodLocale {
  return (SYNOD_LOCALES as readonly string[]).includes(value)
}

/** Normalize browser / profile locale strings to a supported Synod locale. */
export function normalizeUiLocale(uiLocale: string | null | undefined): SynodLocale {
  if (!uiLocale) return 'en'
  const raw = uiLocale.trim().toLowerCase()
  if (!raw) return 'en'

  if (raw.startsWith('ko')) return 'ko'
  if (raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.includes('hant')) return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-TW'
  if (raw.startsWith('fr')) return 'fr'
  if (raw.startsWith('ar')) return 'ar'
  if (raw.startsWith('es')) return 'es'
  if (raw.startsWith('pt')) return 'pt'
  if (raw.startsWith('en')) return 'en'

  const base = raw.split('-')[0]
  if (isSynodLocale(base)) return base
  if (base === 'zh') return 'zh-TW'

  return 'en'
}

type ScriptCounts = {
  hangul: number
  hiragana: number
  katakana: number
  han: number
  arabic: number
  latin: number
}

function countScripts(text: string): ScriptCounts {
  const counts: ScriptCounts = {
    hangul: 0,
    hiragana: 0,
    katakana: 0,
    han: 0,
    arabic: 0,
    latin: 0,
  }

  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code == null) continue

    if (
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3130 && code <= 0x318f)
    ) {
      counts.hangul++
    } else if (code >= 0x3040 && code <= 0x309f) {
      counts.hiragana++
    } else if (code >= 0x30a0 && code <= 0x30ff) {
      counts.katakana++
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      counts.han++
    } else if (
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x08a0 && code <= 0x08ff) ||
      (code >= 0xfb50 && code <= 0xfdff) ||
      (code >= 0xfe70 && code <= 0xfeff)
    ) {
      counts.arabic++
    } else if (/[a-zA-ZÀ-ÿ]/.test(ch)) {
      counts.latin++
    }
  }

  return counts
}

/**
 * Detect question language from script (B). Latin-script questions (en/fr/es/pt)
 * cannot be distinguished reliably from characters alone, so we return null and
 * defer to uiLocale (A). Japanese kana takes precedence over isolated Han.
 */
function detectQuestionLocale(question: string): SynodLocale | null {
  const text = question.trim()
  if (!text) return null

  const { hangul, hiragana, katakana, han, arabic } = countScripts(text)
  const kana = hiragana + katakana
  const significant = hangul + kana + han + arabic
  if (significant === 0) return null

  if (hangul > 0 && hangul >= kana && hangul >= han) return 'ko'
  if (kana > 0) return 'ja'
  if (arabic > 0 && arabic >= hangul + kana + han) return 'ar'
  if (han > 0 && kana === 0) return 'zh-TW'

  return null
}

/**
 * Resolve SYNOD UI locale: question script detection first (B), then browser /
 * profile uiLocale (A), then English. Latin-script languages are not guessed from
 * question text — uiLocale is used instead.
 */
export function resolveSynodLocale(question: string, uiLocale: string | null): SynodLocale {
  const detected = detectQuestionLocale(question)
  if (detected) return detected
  return normalizeUiLocale(uiLocale)
}
