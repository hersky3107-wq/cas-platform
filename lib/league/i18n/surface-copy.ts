import type { LeagueLocale } from './locales'

/** Extra-seat role and basis lines live in `lib/league/extra/descriptions.ts`. */
export type LeagueSurfaceCopy = {
  extra: {
    intro: string
  }
  arena: {
    title: string
    thinking: string
    elapsed: (minutes: number) => string
    remaining: (minutes: number) => string
    tierRemaining: (minutes: number) => string
    noVotes: string
    facts: readonly string[]
  }
  doors: {
    sceneTitle: string
    financeTitle: string
    /** Large English word on the finance door. Same in every locale. */
    financeMark: string
    financeTagline: string
    financeRooms: readonly string[]
    /** Kept apart from financeRooms: the Korean lane blocks memecoin, so that door must not name it. */
    memecoinRoom: string
    worldTitle: string
    /** Large English word on the world door. Same in every locale. */
    worldMark: string
    worldTagline: string
    /** Small second line under the EVENTS tagline. */
    worldTaglineHint: string
    worldRooms: readonly string[]
    enter: string
    backToDoors: string
    previewAsUser: string
    previewAsOperator: string
    testBadge: string
  }
}

const ko: LeagueSurfaceCopy = {
  extra: {
    intro: '40개 AI와 다른 방식으로 보는 특별 좌석입니다. 채점은 하지만 40 AI 종합에는 섞지 않습니다.',
  },
  arena: {
    title: 'AI 경기장',
    thinking: '지금 생각 중',
    elapsed: (minutes) => `경과 ${minutes}분`,
    remaining: (minutes) => `약 ${minutes}분 남음`,
    tierRemaining: (minutes) => `약 ${minutes}분`,
    noVotes: '아직 표가 없습니다',
    facts: [
      '1부는 각 회사 최상위 모델입니다',
      '스카웃은 각자 웹을 검색합니다',
      '같은 재료를 받아도 AI마다 결론이 다릅니다',
      '엑스트라는 종합에 섞이지 않습니다',
      '까마귀는 반대를 위한 반대를 하지 않습니다',
      '시장 기준선은 시장이 없으면 쉽니다',
      '채점이 끝나야 맞았는지 알 수 있습니다',
      '대기 순서는 먼저 들어온 질문부터입니다',
      '점술 자리는 데이터를 보지 않습니다',
    ],
  },
  doors: {
    sceneTitle: 'AI 예측 리그',
    financeTitle: '금융 예측',
    financeMark: 'MARKETS',
    financeTagline: '40개가 넘는 AI가 시장의 방향을 예측합니다',
    financeRooms: ['주식', '암호화폐', '외환', '금·귀금속', '지수/ETF', '원자재·에너지'],
    memecoinRoom: '밈코인',
    worldTitle: '이슈 예측',
    worldMark: 'EVENTS',
    worldTagline: '40개가 넘는 AI가 세상일의 결과를 예측합니다',
    worldTaglineHint: '질문은 예/아니오로',
    worldRooms: ['정치·선거', '엔터테인먼트', '스포츠', '부동산', '테크', 'AI 순위'],
    enter: '들어가기',
    backToDoors: '← 대문으로',
    previewAsUser: '일반 사용자로 보기',
    previewAsOperator: '운영자로 보기',
    testBadge: '테스트',
  },
}

const en: LeagueSurfaceCopy = {
  extra: {
    intro: 'Special seats that look at the question differently from the 40 AIs. They are graded, and they stay out of the 40-AI total.',
  },
  arena: {
    title: 'AI arena',
    thinking: 'Thinking',
    elapsed: (minutes) => `${minutes} min elapsed`,
    remaining: (minutes) => `about ${minutes} min left`,
    tierRemaining: (minutes) => `about ${minutes} min`,
    noVotes: 'No votes yet',
    facts: [
      'Premier is each company’s top model',
      'Scout seats each search the web',
      'The same brief can lead each AI to a different call',
      'Extra seats stay out of the combined total',
      'The crow does not oppose for its own sake',
      'The market baseline sits out when there is no market',
      'A call is right or wrong only after grading',
      'The queue takes questions in arrival order',
      'The fortune seat does not look at the data',
    ],
  },
  doors: {
    sceneTitle: 'AI Prediction League',
    financeTitle: 'Finance',
    financeMark: 'MARKETS',
    financeTagline: 'More than 40 AIs predict the direction of the market',
    financeRooms: ['Stocks', 'Crypto', 'FX', 'Gold & metals', 'Index / ETF', 'Commodities & energy'],
    memecoinRoom: 'Memecoins',
    worldTitle: 'Event Predictions',
    worldMark: 'EVENTS',
    worldTagline: 'More than 40 AIs predict the outcome of world events',
    worldTaglineHint: 'Questions are yes or no',
    worldRooms: ['Politics & elections', 'Entertainment', 'Sports', 'Housing', 'Tech', 'AI Rankings'],
    enter: 'Enter',
    backToDoors: '← Doors',
    previewAsUser: 'View as a normal user',
    previewAsOperator: 'View as operator',
    testBadge: 'Test',
  },
}

const ja: LeagueSurfaceCopy = {
  extra: {
    intro: '40のAIとは別の見方をする特別席です。採点はしますが、40 AIの総合には混ぜません。',
  },
  arena: {
    title: 'AIアリーナ',
    thinking: '考え中',
    elapsed: (minutes) => `経過 ${minutes}分`,
    remaining: (minutes) => `約${minutes}分残り`,
    tierRemaining: (minutes) => `約${minutes}分`,
    noVotes: 'まだ票がありません',
    facts: [
      '1部は各社の最上位モデルです',
      'スカウトは各自ウェブを検索します',
      '同じ材料でもAIごとに結論は違います',
      'エクストラは総合に混ぜません',
      'カラスは反対のための反対をしません',
      '市場の基準線は市場がなければ休みます',
      '当たったかは採点が終わるまで分かりません',
      '待ち順は先に来た質問からです',
      '占いの席はデータを見ません',
    ],
  },
  doors: {
    sceneTitle: 'AI予測リーグ',
    financeTitle: '金融予測',
    financeMark: 'MARKETS',
    financeTagline: '40体を超えるAIが市場の方向を予測します',
    financeRooms: ['株', '暗号資産', '為替', '金・貴金属', '指数/ETF', '商品・エネルギー'],
    memecoinRoom: 'ミームコイン',
    worldTitle: 'イベント予測',
    worldMark: 'EVENTS',
    worldTagline: '40体を超えるAIが世の中の出来事の結果を予測します',
    worldTaglineHint: '質問ははい/いいえです',
    worldRooms: ['政治・選挙', 'エンタメ', 'スポーツ', '不動産', 'テック', 'AI順位'],
    enter: '入る',
    backToDoors: '← 玄関へ',
    previewAsUser: '一般ユーザーとして見る',
    previewAsOperator: '運営者として見る',
    testBadge: 'テスト',
  },
}

const zhTW: LeagueSurfaceCopy = {
  extra: {
    intro: '用和40個AI不同方式看問題的特別席。會計分，但不混進40 AI的總合。',
  },
  arena: {
    title: 'AI 競技場',
    thinking: '思考中',
    elapsed: (minutes) => `已過 ${minutes} 分`,
    remaining: (minutes) => `大約還要 ${minutes} 分`,
    tierRemaining: (minutes) => `約 ${minutes} 分`,
    noVotes: '還沒有票',
    facts: [
      '一部是各家的最頂模型',
      '偵察席各自搜尋網頁',
      '同一份材料，每個AI結論可以不同',
      '特別席不混進總合',
      '烏鴉不會為了反對而反對',
      '沒有市場時，市場基準線就休息',
      '要等評分結束才知道對不對',
      '排隊順序是先到的問題先開始',
      '占卜席不看數據',
    ],
  },
  doors: {
    sceneTitle: 'AI預測聯盟',
    financeTitle: '金融預測',
    financeMark: 'MARKETS',
    financeTagline: '超過40個AI預測市場的方向',
    financeRooms: ['股票', '加密貨幣', '外匯', '黃金與金屬', '指數/ETF', '原物料與能源'],
    memecoinRoom: '迷因幣',
    worldTitle: '議題預測',
    worldMark: 'EVENTS',
    worldTagline: '超過40個AI預測世間事的結果',
    worldTaglineHint: '問題為是或否',
    worldRooms: ['政治與選舉', '娛樂', '運動', '房地產', '科技', 'AI 排名'],
    enter: '進入',
    backToDoors: '← 大門',
    previewAsUser: '以一般使用者檢視',
    previewAsOperator: '以營運者檢視',
    testBadge: '測試',
  },
}

const fr: LeagueSurfaceCopy = {
  extra: {
    intro: 'Des sièges à part, qui ne voient pas comme les 40 IA. Ils sont notés, et ils restent hors du total des 40.',
  },
  arena: {
    title: 'Arène IA',
    thinking: 'Réfléchit',
    elapsed: (minutes) => `${minutes} min écoulées`,
    remaining: (minutes) => `environ ${minutes} min restantes`,
    tierRemaining: (minutes) => `environ ${minutes} min`,
    noVotes: 'Pas encore de voix',
    facts: [
      'Le 1er niveau, ce sont les modèles phares de chaque maison',
      'Les éclaireurs cherchent chacun sur le web',
      'Le même dossier peut donner une conclusion différente à chaque IA',
      'Les sièges extra n’entrent pas dans le total',
      'Le corbeau ne s’oppose pas pour s’opposer',
      'Sans marché, la base de marché se tait',
      'On ne sait si c’est juste qu’après la notation',
      'La file prend les questions dans l’ordre d’arrivée',
      'Le siège du tirage ne lit pas les données',
    ],
  },
  doors: {
    sceneTitle: 'Ligue de prédiction IA',
    financeTitle: 'Finance',
    financeMark: 'MARKETS',
    financeTagline: 'Plus de 40 IA prédisent la direction du marché',
    financeRooms: ['Actions', 'Crypto', 'Changes', 'Or et métaux', 'Indices / ETF', 'Matières et énergie'],
    memecoinRoom: 'Memecoins',
    worldTitle: "Prédictions d'événements",
    worldMark: 'EVENTS',
    worldTagline: 'Plus de 40 IA prédisent le résultat des événements',
    worldTaglineHint: 'Les questions sont oui ou non',
    worldRooms: ['Politique et élections', 'Divertissement', 'Sport', 'Immobilier', 'Tech', 'Classements IA'],
    enter: 'Entrer',
    backToDoors: '← Portes',
    previewAsUser: 'Voir comme un utilisateur',
    previewAsOperator: 'Voir comme opérateur',
    testBadge: 'Test',
  },
}

const es: LeagueSurfaceCopy = {
  extra: {
    intro: 'Asientos especiales que miran distinto a las 40 IA. Se califican y no entran en el total de las 40.',
  },
  arena: {
    title: 'Arena de IA',
    thinking: 'Pensando',
    elapsed: (minutes) => `${minutes} min transcurridos`,
    remaining: (minutes) => `unos ${minutes} min restantes`,
    tierRemaining: (minutes) => `unos ${minutes} min`,
    noVotes: 'Aún no hay votos',
    facts: [
      'La primera división son los modelos tope de cada casa',
      'Los exploradores buscan cada uno en la web',
      'El mismo material puede llevar a cada IA a otra conclusión',
      'Los asientos extra no entran en el total',
      'El cuervo no se opone por oponerse',
      'Sin mercado, la base de mercado descansa',
      'Solo al calificar se sabe si acertó',
      'La cola sigue el orden de llegada',
      'El asiento del oráculo no mira los datos',
    ],
  },
  doors: {
    sceneTitle: 'Liga de predicción IA',
    financeTitle: 'Finanzas',
    financeMark: 'MARKETS',
    financeTagline: 'Más de 40 IA predicen la dirección del mercado',
    financeRooms: ['Acciones', 'Cripto', 'Divisas', 'Oro y metales', 'Índices / ETF', 'Materias y energía'],
    memecoinRoom: 'Memecoins',
    worldTitle: 'Predicciones de eventos',
    worldMark: 'EVENTS',
    worldTagline: 'Más de 40 IA predicen el resultado de los acontecimientos',
    worldTaglineHint: 'Las preguntas son sí o no',
    worldRooms: ['Política y elecciones', 'Entretenimiento', 'Deporte', 'Vivienda', 'Tech', 'Rankings de IA'],
    enter: 'Entrar',
    backToDoors: '← Puertas',
    previewAsUser: 'Ver como usuario',
    previewAsOperator: 'Ver como operador',
    testBadge: 'Prueba',
  },
}

const ar: LeagueSurfaceCopy = {
  extra: {
    intro: 'مقاعد خاصة ترى السؤال بطريقة غير طريقة الـ40. تُقيَّم ولا تدخل في مجموع الأربعين.',
  },
  arena: {
    title: 'ساحة الذكاء',
    thinking: 'يفكر الآن',
    elapsed: (minutes) => `مضت ${minutes} د`,
    remaining: (minutes) => `حوالي ${minutes} د متبقية`,
    tierRemaining: (minutes) => `حوالي ${minutes} د`,
    noVotes: 'لا أصوات بعد',
    facts: [
      'القسم الأول هو النموذج الأعلى لكل شركة',
      'الكشافة يبحث كل واحد على الويب',
      'المادة نفسها قد تعطي كل نموذج نتيجة مختلفة',
      'المقاعد الخاصة لا تدخل في المجموع',
      'الغراب لا يعارض لمجرد المعارضة',
      'خط السوق يستريح إذا لم يوجد سوق',
      'لا نعرف الصواب إلا بعد التقييم',
      'الانتظار يتبع ترتيب الوصول',
      'مقعد العرافة لا ينظر إلى البيانات',
    ],
  },
  doors: {
    sceneTitle: 'دوري توقعات الذكاء الاصطناعي',
    financeTitle: 'توقعات المال',
    financeMark: 'MARKETS',
    financeTagline: 'أكثر من 40 نموذج ذكاء اصطناعي يتوقعون اتجاه السوق',
    financeRooms: ['أسهم', 'عملات مشفرة', 'نقد', 'ذهب ومعادن', 'مؤشرات/صناديق', 'سلع وطاقة'],
    memecoinRoom: 'عملات الميم',
    worldTitle: 'توقعات الأحداث',
    worldMark: 'EVENTS',
    worldTagline: 'أكثر من 40 نموذج ذكاء اصطناعي يتوقعون نتائج أحداث العالم',
    worldTaglineHint: 'الأسئلة بنعم أو لا',
    worldRooms: ['سياسة وانتخابات', 'ترفيه', 'رياضة', 'عقار', 'تقنية', 'ترتيب الذكاء الاصطناعي'],
    enter: 'دخول',
    backToDoors: '← الأبواب',
    previewAsUser: 'عرض كمستخدم عادي',
    previewAsOperator: 'عرض كمشغّل',
    testBadge: 'اختبار',
  },
}

const pt: LeagueSurfaceCopy = {
  extra: {
    intro: 'Assentos especiais que olham de outro jeito que as 40 IAs. São pontuados e ficam fora do total das 40.',
  },
  arena: {
    title: 'Arena de IA',
    thinking: 'Pensando',
    elapsed: (minutes) => `${minutes} min decorridos`,
    remaining: (minutes) => `cerca de ${minutes} min restantes`,
    tierRemaining: (minutes) => `cerca de ${minutes} min`,
    noVotes: 'Ainda sem votos',
    facts: [
      'A primeira divisão são os modelos de topo de cada casa',
      'Os olheiros pesquisam cada um na web',
      'O mesmo material pode levar cada IA a outra conclusão',
      'Os assentos extra não entram no total',
      'O corvo não discorda por discordar',
      'Sem mercado, a linha de mercado descansa',
      'Só depois da nota se sabe se acertou',
      'A fila segue a ordem de chegada',
      'O assento da leitura não olha os dados',
    ],
  },
  doors: {
    sceneTitle: 'Liga de previsão de IA',
    financeTitle: 'Finanças',
    financeMark: 'MARKETS',
    financeTagline: 'Mais de 40 IAs preveem a direção do mercado',
    financeRooms: ['Ações', 'Cripto', 'Câmbio', 'Ouro e metais', 'Índices / ETF', 'Commodities e energia'],
    memecoinRoom: 'Memecoins',
    worldTitle: 'Previsões de eventos',
    worldMark: 'EVENTS',
    worldTagline: 'Mais de 40 IAs preveem o resultado dos acontecimentos',
    worldTaglineHint: 'As perguntas são sim ou não',
    worldRooms: ['Política e eleições', 'Entretenimento', 'Esporte', 'Imóveis', 'Tech', 'Rankings de IA'],
    enter: 'Entrar',
    backToDoors: '← Portas',
    previewAsUser: 'Ver como usuário',
    previewAsOperator: 'Ver como operador',
    testBadge: 'Teste',
  },
}

const COPY: Record<LeagueLocale, LeagueSurfaceCopy> = {
  en,
  ko,
  ja,
  'zh-TW': zhTW,
  fr,
  es,
  ar,
  pt,
}

export function leagueSurfaceCopy(locale: LeagueLocale): LeagueSurfaceCopy {
  return COPY[locale]
}
