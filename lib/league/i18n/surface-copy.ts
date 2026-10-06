import type { ExtraSeatId } from '../extra/seats'
import type { LeagueLocale } from './locales'

export type ExtraRoleCopy = { line: string; detail: string }

export type LeagueSurfaceCopy = {
  extra: {
    intro: string
    more: string
    role: Record<ExtraSeatId, ExtraRoleCopy>
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
    financeTitle: string
    financeBody: string
    /** Korean lane only. Memecoin is blocked there, so the door must not name it. */
    financeBodyNoMemecoin?: string
    financeItems: string
    financeItemsNoMemecoin?: string
    worldTitle: string
    worldBody: string
    worldItems: string
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
    more: '자세히',
    role: {
      divination: {
        line: '오락용 점괘. 데이터는 보지 않습니다.',
        detail: '날짜·괘·타로·룬으로 보는 오락용 점괘. 데이터는 보지 않습니다.',
      },
      sentiment: {
        line: '웹에 드러난 여론을 읽습니다.',
        detail: '웹에 드러난 여론과 화제의 분위기를 읽습니다.',
      },
      history: {
        line: '과거 비슷한 흐름에서 패턴을 찾습니다.',
        detail: '과거 비슷한 흐름(차트·전적·출시 주기)에서 패턴을 찾습니다.',
      },
      consensus: {
        line: '돈이 걸린 시장의 확률을 기준선으로 보여줍니다.',
        detail: '돈이 걸린 시장(예측시장·배당)이 매긴 확률을 기준선으로 보여줍니다. 시장이 없으면 쉽니다.',
      },
      crow: {
        line: '다수가 놓친 위험을 찾습니다.',
        detail: '다수가 놓친 과열·쏠림·이변 위험을 찾는 역할입니다. 반대를 위한 반대는 하지 않습니다.',
      },
      replay: {
        line: '지난 채점 기록에서 배운 교훈으로 예측합니다.',
        detail: '리그의 지난 채점 기록에서 배운 교훈으로 예측합니다. 기록이 쌓일수록 똑똑해집니다.',
      },
    },
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
    financeTitle: '금융 예측',
    financeBody: '시장 방향만 예측합니다. AI 40개가 같은 재료를 보고 서로 다른 결론을 냅니다.',
    financeBodyNoMemecoin: '시장 방향만 예측합니다. AI 40개가 같은 재료를 보고 서로 다른 결론을 냅니다.',
    financeItems: '주식 · 암호화폐 · 외환 · 금·귀금속 · 지수/ETF · 원자재·에너지 · 밈코인',
    financeItemsNoMemecoin: '주식 · 암호화폐 · 외환 · 금·귀금속 · 지수/ETF · 원자재·에너지',
    worldTitle: '세상 예측',
    worldBody: '세상일에 예/아니오로 물어보세요. 공개된 일정과 공식 발표로 채점합니다.',
    worldItems: '정치·선거 · 엔터테인먼트 · 스포츠 · 부동산 · 테크·AI 순위',
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
    more: 'More',
    role: {
      divination: {
        line: 'An entertainment reading. It does not look at the data.',
        detail: 'An entertainment reading from the date, hexagrams, tarot, and runes. It does not look at the data.',
      },
      sentiment: {
        line: 'It reads the public mood on the web.',
        detail: 'It reads the public mood and the tone of what is being talked about on the web.',
      },
      history: {
        line: 'It looks for a pattern in similar past runs.',
        detail: 'It looks for a pattern in similar past runs — charts, records, and release cycles.',
      },
      consensus: {
        line: 'It shows the probability priced by markets with money at stake.',
        detail: 'It shows, as a baseline, the probability priced by markets with money at stake. If there is no market, it sits out.',
      },
      crow: {
        line: 'It looks for the risk the crowd skipped.',
        detail: 'Its job is to find overheating, crowding, and upset risk the majority missed. It does not oppose for its own sake.',
      },
      replay: {
        line: 'It predicts from lessons in this league’s past grades.',
        detail: 'It predicts from lessons in this league’s past grades. It gets sharper as the record grows.',
      },
    },
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
    financeTitle: 'Finance',
    financeBody: 'Direction only. Forty AIs read the same brief and can still disagree.',
    financeItems: 'Stocks · Crypto · FX · Gold & metals · Index / ETF · Commodities & energy · Memecoins',
    financeItemsNoMemecoin: 'Stocks · Crypto · FX · Gold & metals · Index / ETF · Commodities & energy',
    worldTitle: 'The world',
    worldBody: 'Ask yes or no about the world. Official calendars and publications grade the call.',
    worldItems: 'Politics & elections · Entertainment · Sports · Housing · Tech & AI rankings',
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
    more: '詳しく',
    role: {
      divination: { line: '娯楽の占いです。データは見ません。', detail: '日付・卦・タロット・ルーンで見る娯楽の占いです。データは見ません。' },
      sentiment: { line: 'ウェブ上の空気を読みます。', detail: 'ウェブに出ている世論と話題の空気を読みます。' },
      history: { line: '似た過去の流れから型を探します。', detail: '似た過去の流れ（チャート・対戦成績・発売周期）から型を探します。' },
      consensus: { line: 'お金が動く市場の確率を基準にします。', detail: 'お金が動く市場が付けた確率を基準線として出します。市場がなければ休みます。' },
      crow: { line: '多数が見落としたリスクを探します。', detail: '多数が見落とした過熱・偏り・番狂わせの危険を探す役です。反対のための反対はしません。' },
      replay: { line: '過去の採点から学んで予測します。', detail: 'リーグの過去の採点から学んだ教訓で予測します。記録が増えるほど鋭くなります。' },
    },
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
    financeTitle: '金融予測',
    financeBody: '方向だけを予測します。AI 40体が同じ材料を見ても結論は分かれます。',
    financeItems: '株 · 暗号資産 · 為替 · 金・貴金属 · 指数/ETF · 商品・エネルギー · ミームコイン',
    financeItemsNoMemecoin: '株 · 暗号資産 · 為替 · 金・貴金属 · 指数/ETF · 商品・エネルギー',
    worldTitle: '世界の予測',
    worldBody: '世の中の出来事をはい/いいえで聞いてください。公式の日程と発表で採点します。',
    worldItems: '政治・選挙 · エンタメ · スポーツ · 不動産 · テック・AI順位',
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
    more: '更多',
    role: {
      divination: { line: '娛樂用占卜。不看數據。', detail: '用日期、卦、塔羅、符文看的娛樂占卜。不看數據。' },
      sentiment: { line: '讀網路上的輿論氣氛。', detail: '讀網路上公開的輿論和話題氣氛。' },
      history: { line: '從過去相似的走勢找規律。', detail: '從過去相似的走勢（圖表、戰績、發布週期）找規律。' },
      consensus: { line: '把有資金的市場機率當基準線。', detail: '把有資金的市場所定的機率當成基準線。沒有市場就休息。' },
      crow: { line: '找多數人忽略的風險。', detail: '負責找多數人忽略的過熱、偏斜和冷門風險。不會為了反對而反對。' },
      replay: { line: '用過去評分的教訓來預測。', detail: '用聯賽過去的評分紀錄學到的教訓來預測。紀錄愈多愈準。' },
    },
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
    financeTitle: '金融預測',
    financeBody: '只預測方向。40個AI看同一份材料，結論仍可能不同。',
    financeItems: '股票 · 加密貨幣 · 外匯 · 黃金與金屬 · 指數/ETF · 原物料與能源 · 迷因幣',
    financeItemsNoMemecoin: '股票 · 加密貨幣 · 外匯 · 黃金與金屬 · 指數/ETF · 原物料與能源',
    worldTitle: '世界預測',
    worldBody: '用是／否問世上的事。公開行程與官方發布用來評分。',
    worldItems: '政治與選舉 · 娛樂 · 運動 · 房地產 · 科技與AI排名',
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
    more: 'Plus',
    role: {
      divination: { line: 'Un tirage pour le jeu. Il ne lit pas les données.', detail: 'Un tirage de date, d’hexagramme, de tarot et de runes, pour le jeu. Il ne lit pas les données.' },
      sentiment: { line: 'Il lit l’humeur publique sur le web.', detail: 'Il lit l’opinion publique et l’ambiance de ce dont on parle sur le web.' },
      history: { line: 'Il cherche un motif dans des séries passées.', detail: 'Il cherche un motif dans des séries passées : graphiques, bilans, cycles de sortie.' },
      consensus: { line: 'Il montre la probabilité des marchés où l’argent est engagé.', detail: 'Il montre, comme base, la probabilité fixée par les marchés où l’argent est engagé. Sans marché, il se tait.' },
      crow: { line: 'Il cherche le risque que la foule a manqué.', detail: 'Son rôle est de trouver la surchauffe, le déséquilibre et le risque de surprise. Il ne s’oppose pas pour s’opposer.' },
      replay: { line: 'Il prédit à partir des leçons des notes passées.', detail: 'Il prédit à partir des leçons des notes passées de la ligue. Il s’affine à mesure que l’historique grandit.' },
    },
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
    financeTitle: 'Finance',
    financeBody: 'La direction seulement. Quarante IA lisent le même dossier et peuvent encore diverger.',
    financeItems: 'Actions · Crypto · Changes · Or et métaux · Indices / ETF · Matières et énergie · Memecoins',
    financeItemsNoMemecoin: 'Actions · Crypto · Changes · Or et métaux · Indices / ETF · Matières et énergie',
    worldTitle: 'Le monde',
    worldBody: 'Posez une question oui/non sur le monde. Les calendriers et publications officiels notent l’appel.',
    worldItems: 'Politique et élections · Divertissement · Sport · Immobilier · Tech et classements IA',
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
    more: 'Más',
    role: {
      divination: { line: 'Una lectura de entretenimiento. No mira los datos.', detail: 'Una lectura de entretenimiento con la fecha, hexagramas, tarot y runas. No mira los datos.' },
      sentiment: { line: 'Lee el ánimo público en la web.', detail: 'Lee la opinión pública y el ambiente de lo que se comenta en la web.' },
      history: { line: 'Busca un patrón en rachas parecidas del pasado.', detail: 'Busca un patrón en rachas parecidas del pasado: gráficos, marcas y ciclos de lanzamiento.' },
      consensus: { line: 'Muestra la probabilidad que ponen los mercados con dinero.', detail: 'Muestra como base la probabilidad que ponen los mercados con dinero en juego. Si no hay mercado, descansa.' },
      crow: { line: 'Busca el riesgo que la mayoría pasó por alto.', detail: 'Su papel es encontrar el sobrecalentamiento, el sesgo y el riesgo de sorpresa. No se opone por oponerse.' },
      replay: { line: 'Predice con lo aprendido de las notas pasadas.', detail: 'Predice con lo aprendido de las notas pasadas de la liga. Mejora a medida que crece el historial.' },
    },
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
    financeTitle: 'Finanzas',
    financeBody: 'Solo la dirección. Cuarenta IA leen el mismo briefing y aún pueden discrepar.',
    financeItems: 'Acciones · Cripto · Divisas · Oro y metales · Índices / ETF · Materias y energía · Memecoins',
    financeItemsNoMemecoin: 'Acciones · Cripto · Divisas · Oro y metales · Índices / ETF · Materias y energía',
    worldTitle: 'El mundo',
    worldBody: 'Pregunta sí o no sobre el mundo. Los calendarios y publicaciones oficiales califican la llamada.',
    worldItems: 'Política y elecciones · Entretenimiento · Deporte · Vivienda · Tech y rankings de IA',
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
    more: 'المزيد',
    role: {
      divination: { line: 'قراءة للترفيه. لا ينظر إلى البيانات.', detail: 'قراءة ترفيهية من التاريخ والهيكساغرام والتارو والرموز. لا ينظر إلى البيانات.' },
      sentiment: { line: 'يقرأ مزاج الناس على الويب.', detail: 'يقرأ الرأي العام وأجواء ما يدور على الويب.' },
      history: { line: 'يبحث عن نمط في مسارات ماضية شبيهة.', detail: 'يبحث عن نمط في مسارات ماضية شبيهة: الرسوم والسجلات ودورات الإصدار.' },
      consensus: { line: 'يعرض احتمال الأسواق التي فيها مال.', detail: 'يعرض كخط أساس الاحتمال الذي تضعه الأسواق التي فيها مال. إن لم يوجد سوق، يستريح.' },
      crow: { line: 'يبحث عن الخطر الذي فات الأغلبية.', detail: 'دوره إيجاد خطر الحمى والانحياز والمفاجأة الذي فات الأغلبية. لا يعارض لمجرد المعارضة.' },
      replay: { line: 'يتنبأ من دروس التقييمات السابقة.', detail: 'يتنبأ من دروس تقييمات الدوري السابقة. يزداد حدة كلما زاد السجل.' },
    },
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
    financeTitle: 'توقعات المال',
    financeBody: 'الاتجاه فقط. أربعون نموذجًا يقرأون المادة نفسها وقد يختلفون.',
    financeItems: 'أسهم · عملات مشفرة · نقد · ذهب ومعادن · مؤشرات/صناديق · سلع وطاقة · عملات الميم',
    financeItemsNoMemecoin: 'أسهم · عملات مشفرة · نقد · ذهب ومعادن · مؤشرات/صناديق · سلع وطاقة',
    worldTitle: 'توقعات العالم',
    worldBody: 'اسأل بنعم أو لا عن العالم. الجداول والمنشورات الرسمية تقيّم النداء.',
    worldItems: 'سياسة وانتخابات · ترفيه · رياضة · عقار · تقنية وترتيب الذكاء',
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
    more: 'Mais',
    role: {
      divination: { line: 'Uma leitura de entretenimento. Não olha os dados.', detail: 'Uma leitura de entretenimento com a data, hexagramas, tarô e runas. Não olha os dados.' },
      sentiment: { line: 'Lê o clima público na web.', detail: 'Lê a opinião pública e o clima do que se comenta na web.' },
      history: { line: 'Procura um padrão em sequências parecidas do passado.', detail: 'Procura um padrão em sequências parecidas do passado: gráficos, retrospectos e ciclos de lançamento.' },
      consensus: { line: 'Mostra a probabilidade dos mercados com dinheiro em jogo.', detail: 'Mostra como base a probabilidade dos mercados com dinheiro em jogo. Sem mercado, ele descansa.' },
      crow: { line: 'Procura o risco que a maioria deixou passar.', detail: 'O papel dele é achar superaquecimento, viés e risco de surpresa. Ele não discorda por discordar.' },
      replay: { line: 'Prevê com o que aprendeu das notas passadas.', detail: 'Prevê com as lições das notas passadas da liga. Fica mais afiado conforme o histórico cresce.' },
    },
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
    financeTitle: 'Finanças',
    financeBody: 'Só a direção. Quarenta IAs leem o mesmo briefing e ainda podem discordar.',
    financeItems: 'Ações · Cripto · Câmbio · Ouro e metais · Índices / ETF · Commodities e energia · Memecoins',
    financeItemsNoMemecoin: 'Ações · Cripto · Câmbio · Ouro e metais · Índices / ETF · Commodities e energia',
    worldTitle: 'O mundo',
    worldBody: 'Pergunte sim ou não sobre o mundo. Calendários e publicações oficiais pontuam a chamada.',
    worldItems: 'Política e eleições · Entretenimento · Esporte · Imóveis · Tech e rankings de IA',
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
