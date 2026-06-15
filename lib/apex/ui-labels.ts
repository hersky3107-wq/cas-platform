import {
  type SynodLocale,
} from '@/lib/synod/ui-labels'

export type { SynodLocale }
export { resolveSynodLocale, normalizeUiLocale } from '@/lib/synod/ui-labels'

export type ApexUiPack = {
  headerTagline: string
  idleHero: string
  examplesLabel: string
  examples: string[]
  placeholder: string
  /** "Run APEX · " — "APEX" stays untranslated; credits number + creditsSuffix appended in page. */
  runLabel: string
  creditsSuffix: string
  loading: string
  /** Shown while the synthesis model is running after all debaters finish. */
  synthesizing: string
  partialNote: string
  /** "APEX Synthesis" — "APEX" stays untranslated. */
  synthesisHeading: string
  newBadge: string
  ms: string
  back: string
  insufficientCredits: string
  requestFailed: (status: number) => string
  malformedResponse: string
  networkError: string
  requestFailedGeneric: string
}

export const APEX_UI: Record<SynodLocale, ApexUiPack> = {
  en: {
    headerTagline: "The newest, most powerful AI models — together, on one question.",
    idleHero: "The world\u2019s newest, most powerful AI models \u2014 together, on one question.",
    examplesLabel: "Try one of these",
    examples: [
      "What\u2019s the single most underrated lever for extending human healthspan in the next decade?",
      "If you had to design a fairer global tax system from scratch, what would it look like?",
      "Will artificial general intelligence be a bigger deal than the internet? Why or why not?",
      "What\u2019s the most compelling unsolved question in physics today?",
    ],
    placeholder: "Ask the world\u2019s best models anything\u2026",
    runLabel: "Run APEX \u00b7 ",
    creditsSuffix: " credits",
    loading: "Convening the world\u2019s top models\u2026",
    synthesizing: "Synthesizing the panel\u2019s answers\u2026",
    partialNote: "Some models didn\u2019t respond \u2014 synthesized from the rest.",
    synthesisHeading: "APEX Synthesis",
    newBadge: "New",
    ms: "ms",
    back: "Back",
    insufficientCredits: "Insufficient credits",
    requestFailed: (s) => `Request failed (${s})`,
    malformedResponse: "Malformed response",
    networkError: "Network error",
    requestFailedGeneric: "Request failed",
  },
  ko: {
    headerTagline: "세계 최신·최강 AI 모델이 하나의 질문에 함께 답합니다.",
    idleHero: "세계에서 가장 새롭고 강력한 AI 모델들이, 하나의 질문에 함께.",
    examplesLabel: "이런 질문은 어때요",
    examples: [
      "앞으로 10년, 인간 건강수명을 늘릴 가장 과소평가된 방법은?",
      "백지에서 더 공정한 글로벌 조세 제도를 설계한다면 어떤 모습일까?",
      "범용인공지능(AGI)은 인터넷보다 더 큰 사건이 될까? 왜 그럴까?",
      "오늘날 물리학에서 가장 흥미로운 미해결 난제는?",
    ],
    placeholder: "세계 최강 AI들에게 무엇이든 물어보세요\u2026",
    runLabel: "APEX 실행 \u00b7 ",
    creditsSuffix: " 크레딧",
    loading: "세계 최강 모델들을 소집하는 중\u2026",
    synthesizing: "패널 답변을 종합하는 중\u2026",
    partialNote: "일부 모델이 응답하지 않아, 나머지로 종합했습니다.",
    synthesisHeading: "APEX 종합",
    newBadge: "신규",
    ms: "ms",
    back: "뒤로",
    insufficientCredits: "크레딧이 부족합니다",
    requestFailed: (s) => `요청 실패 (${s})`,
    malformedResponse: "잘못된 응답",
    networkError: "네트워크 오류",
    requestFailedGeneric: "요청 실패",
  },
  ja: {
    headerTagline: "世界最新・最強のAIモデルが、一つの問いに揃って答えます。",
    idleHero: "世界で最も新しく強力なAIモデルが、一つの問いに揃って。",
    examplesLabel: "こんな質問はいかが",
    examples: [
      "今後10年で、人間の健康寿命を延ばす最も過小評価された手段は？",
      "ゼロからより公平な世界の税制を設計するなら、どんな形になる？",
      "汎用人工知能（AGI）はインターネット以上の出来事になる？その理由は？",
      "今日の物理学で最も魅力的な未解決問題は？",
    ],
    placeholder: "世界最強のAIたちに何でも聞いてみよう\u2026",
    runLabel: "APEXを実行 \u00b7 ",
    creditsSuffix: " クレジット",
    loading: "世界最強のモデルを招集中\u2026",
    synthesizing: "パネルの回答を統合中\u2026",
    partialNote: "一部のモデルが応答しなかったため、残りで総括しました。",
    synthesisHeading: "APEX 総括",
    newBadge: "新着",
    ms: "ms",
    back: "戻る",
    insufficientCredits: "クレジットが不足しています",
    requestFailed: (s) => `リクエスト失敗 (${s})`,
    malformedResponse: "不正な応答",
    networkError: "ネットワークエラー",
    requestFailedGeneric: "リクエスト失敗",
  },
  'zh-TW': {
    headerTagline: "全球最新最強的 AI 模型，一同回答同一個問題。",
    idleHero: "全球最新最強的 AI 模型，齊聚於同一個問題。",
    examplesLabel: "試試這些問題",
    examples: [
      "未來十年，延長人類健康壽命最被低估的關鍵是什麼？",
      "若從零設計更公平的全球稅制，會是什麼樣子？",
      "通用人工智慧（AGI）會比網際網路更具影響力嗎？為什麼？",
      "當今物理學最引人入勝的未解難題是什麼？",
    ],
    placeholder: "向全球最強的 AI 提出任何問題\u2026",
    runLabel: "執行 APEX \u00b7 ",
    creditsSuffix: " 點數",
    loading: "正在召集全球最強模型\u2026",
    synthesizing: "正在綜合各模型的回答\u2026",
    partialNote: "部分模型未回應，已用其餘模型綜合。",
    synthesisHeading: "APEX 綜合",
    newBadge: "全新",
    ms: "ms",
    back: "返回",
    insufficientCredits: "點數不足",
    requestFailed: (s) => `請求失敗 (${s})`,
    malformedResponse: "回應格式錯誤",
    networkError: "網路錯誤",
    requestFailedGeneric: "請求失敗",
  },
  fr: {
    headerTagline: "Les IA les plus récentes et puissantes — réunies, sur une seule question.",
    idleHero: "Les modèles d\u2019IA les plus récents et puissants du monde — réunis, sur une seule question.",
    examplesLabel: "Essayez l\u2019une de celles-ci",
    examples: [
      "Quel est le levier le plus sous-estimé pour prolonger la durée de vie en bonne santé dans la prochaine décennie\u00a0?",
      "Si vous deviez concevoir un système fiscal mondial plus juste à partir de zéro, à quoi ressemblerait-il\u00a0?",
      "L\u2019intelligence artificielle générale sera-t-elle plus importante qu\u2019Internet\u00a0? Pourquoi\u00a0?",
      "Quelle est la question non résolue la plus fascinante en physique aujourd\u2019hui\u00a0?",
    ],
    placeholder: "Posez n\u2019importe quelle question aux meilleurs modèles du monde\u2026",
    runLabel: "Lancer APEX \u00b7 ",
    creditsSuffix: " crédits",
    loading: "Convocation des meilleurs modèles du monde\u2026",
    synthesizing: "Synthèse des réponses du panel\u2026",
    partialNote: "Certains modèles n\u2019ont pas répondu — synthèse faite à partir des autres.",
    synthesisHeading: "Synthèse APEX",
    newBadge: "Nouveau",
    ms: "ms",
    back: "Retour",
    insufficientCredits: "Crédits insuffisants",
    requestFailed: (s) => `Échec de la requête (${s})`,
    malformedResponse: "Réponse mal formée",
    networkError: "Erreur réseau",
    requestFailedGeneric: "Échec de la requête",
  },
  ar: {
    headerTagline: "أحدث وأقوى نماذج الذكاء الاصطناعي — معاً، على سؤال واحد.",
    idleHero: "أحدث وأقوى نماذج الذكاء الاصطناعي في العالم — معاً، على سؤال واحد.",
    examplesLabel: "جرّب أحد هذه الأسئلة",
    examples: [
      "ما هو العامل الأكثر تجاهلاً لإطالة عمر الإنسان الصحي في العقد القادم؟",
      "لو صمّمت نظاماً ضريبياً عالمياً أكثر عدلاً من الصفر، كيف سيبدو؟",
      "هل سيكون الذكاء الاصطناعي العام أهمّ من الإنترنت؟ ولماذا؟",
      "ما هو أكثر سؤال غير محلول إثارةً في الفيزياء اليوم؟",
    ],
    placeholder: "اسأل أقوى نماذج العالم أي شيء\u2026",
    runLabel: "تشغيل APEX \u00b7 ",
    creditsSuffix: " رصيد",
    loading: "جارٍ استدعاء أقوى النماذج في العالم\u2026",
    synthesizing: "جارٍ تركيب إجابات اللجنة\u2026",
    partialNote: "لم تستجب بعض النماذج — تم التركيب من البقية.",
    synthesisHeading: "تركيب APEX",
    newBadge: "جديد",
    ms: "م.ث",
    back: "رجوع",
    insufficientCredits: "الرصيد غير كافٍ",
    requestFailed: (s) => `فشل الطلب (${s})`,
    malformedResponse: "استجابة غير صالحة",
    networkError: "خطأ في الشبكة",
    requestFailedGeneric: "فشل الطلب",
  },
  es: {
    headerTagline: "Los modelos de IA más nuevos y potentes — juntos, en una sola pregunta.",
    idleHero: "Los modelos de IA más nuevos y potentes del mundo — juntos, en una sola pregunta.",
    examplesLabel: "Prueba una de estas",
    examples: [
      "¿Cuál es la palanca más infravalorada para extender la esperanza de vida saludable en la próxima década?",
      "Si tuvieras que diseñar un sistema fiscal global más justo desde cero, ¿cómo sería?",
      "¿Será la inteligencia artificial general más importante que internet? ¿Por qué?",
      "¿Cuál es la pregunta sin resolver más fascinante de la física hoy?",
    ],
    placeholder: "Pregunta lo que sea a los mejores modelos del mundo\u2026",
    runLabel: "Ejecutar APEX \u00b7 ",
    creditsSuffix: " créditos",
    loading: "Convocando a los mejores modelos del mundo\u2026",
    synthesizing: "Sintetizando las respuestas del panel\u2026",
    partialNote: "Algunos modelos no respondieron — sintetizado con el resto.",
    synthesisHeading: "Síntesis APEX",
    newBadge: "Nuevo",
    ms: "ms",
    back: "Atrás",
    insufficientCredits: "Créditos insuficientes",
    requestFailed: (s) => `Error en la solicitud (${s})`,
    malformedResponse: "Respuesta mal formada",
    networkError: "Error de red",
    requestFailedGeneric: "Error en la solicitud",
  },
  pt: {
    headerTagline: "Os modelos de IA mais novos e potentes — juntos, numa só pergunta.",
    idleHero: "Os modelos de IA mais novos e potentes do mundo — juntos, numa só pergunta.",
    examplesLabel: "Experimente uma destas",
    examples: [
      "Qual é a alavanca mais subestimada para estender a longevidade saudável na próxima década?",
      "Se tivesse de desenhar um sistema fiscal global mais justo do zero, como seria?",
      "A inteligência artificial geral será mais importante que a internet? Porquê?",
      "Qual é a questão não resolvida mais fascinante da física hoje?",
    ],
    placeholder: "Pergunte qualquer coisa aos melhores modelos do mundo\u2026",
    runLabel: "Executar APEX \u00b7 ",
    creditsSuffix: " créditos",
    loading: "A convocar os melhores modelos do mundo\u2026",
    synthesizing: "A sintetizar as respostas do painel\u2026",
    partialNote: "Alguns modelos não responderam — sintetizado com os restantes.",
    synthesisHeading: "Síntese APEX",
    newBadge: "Novo",
    ms: "ms",
    back: "Voltar",
    insufficientCredits: "Créditos insuficientes",
    requestFailed: (s) => `Falha no pedido (${s})`,
    malformedResponse: "Resposta malformada",
    networkError: "Erro de rede",
    requestFailedGeneric: "Falha no pedido",
  },
}

/** Localized label pack for a resolved locale; falls back to English. */
export function getApexUiPack(locale: SynodLocale): ApexUiPack {
  return APEX_UI[locale] ?? APEX_UI.en
}
