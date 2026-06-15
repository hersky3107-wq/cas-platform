import type { HelpModalContent } from '@/components/HelpModal'

export const synodHelpContent: HelpModalContent = {
  EN: `How to use SYNOD
Type any question worth debating into the input box, choose Easy or Expert mode, then press 'Convene SYNOD'. The debate starts automatically — just read along as the AIs deliberate across rounds.

What is SYNOD?
SYNOD is a multi-AI deliberation engine where 6 AIs debate a question across multiple rounds to reach the best possible consensus answer. Unlike Compare (parallel responses) or Arena (a multi-round battle where AIs pick sides and fight in teams), SYNOD is a structured debate — AIs challenge, supplement, and reframe each other's arguments until they converge.

How is it different?
· AIs actually respond to each other — not just to your question
· Each round, a Facilitator summarizes consensus and open issues
· Anti-sycophancy design: AIs are anonymized during voting to prevent bias toward popular opinions
· A Verdict Chair (Claude Opus 4.8) writes the final synthesis

Minority Report
Even after consensus is reached, dissenting AIs can file a Minority Report — preserving genuine disagreement rather than forcing fake unanimity. This is one of SYNOD's core features.

Easy vs Expert mode
· Easy: Accessible, conversational tone — anyone can follow
· Expert: Deeper analysis, more technical depth, stronger anti-hallucination guardrails

How to read a SYNOD session
1. Opening — each AI states its independent position
2. Rounds — AIs debate using tags: AGREE / CHALLENGE / SUPPLEMENT / REFRAME
3. RED TEAM — one AI is assigned to argue against the emerging consensus
4. Facilitator summary — consensus score + open issues after each round
5. Final Synthesis — the Verdict Chair's conclusion
6. Minority Report — dissenting views that didn't make it into the consensus

Credits
· Easy mode: 20 credits per session
· Expert mode: 25 credits per session
Charged once at the start. Sessions can be resumed if interrupted.

Sharing
After a session ends, you can vote for the best AI, share the debate, or publish it publicly so search engines can find it.`,

  KO: `SYNOD 사용법
입력창에 토론할 만한 질문을 입력하고, 일반 또는 전문가 모드를 선택한 뒤 'SYNOD 시작'을 누르세요. 토론이 자동으로 시작되고, AI들이 라운드를 거치며 심의하는 과정을 읽으면 됩니다.

SYNOD란?
SYNOD는 6개의 AI가 여러 라운드에 걸쳐 토론하고 최선의 합의에 도달하는 다중 AI 심의 엔진입니다. Compare(병렬 비교)나 Arena(AI들이 편을 갈라 팀전으로 맞붙는 멀티 라운드 배틀)와 달리, AI들이 서로의 주장에 반박·보충·재구성하며 구조적으로 수렴해 나갑니다.

무엇이 다른가요?
· AI들이 단순히 질문에 답하는 게 아니라 서로 실제로 반응합니다
· 매 라운드마다 진행자가 합의 사항과 미해결 쟁점을 정리합니다
· 반사이코펀시 설계: 투표 시 AI를 익명 처리해 인기 의견 쏠림을 방지합니다
· 판정 의장(Claude Opus 4.8)이 최종 종합문을 작성합니다

소수 의견(Minority Report)
합의에 도달한 후에도 반대 의견을 가진 AI는 소수 의견을 제출할 수 있습니다. 억지로 만들어진 합의가 아닌, 진짜 이견을 보존하는 것이 SYNOD의 핵심 특징입니다.

일반 vs 전문가 모드
· 일반: 쉽고 친근한 톤 — 누구나 이해할 수 있는 방식
· 전문가: 더 깊은 분석과 기술적 깊이, 강화된 환각 방지 장치

SYNOD 세션 읽는 법
1. 오프닝 — 각 AI가 독립적인 입장을 표명
2. 라운드 — 동의 / 반박 / 보충 / 재구성 태그로 토론 진행
3. 레드팀 — 한 AI가 등장하는 합의에 반론을 제기하는 역할을 맡음
4. 진행자 요약 — 각 라운드 후 합의 점수와 미해결 쟁점 정리
5. 최종 종합 — 판정 의장의 결론
6. 소수 의견 — 합의에 포함되지 않은 반대 의견

크레딧
· 일반 모드: 세션당 20 크레딧
· 전문가 모드: 세션당 25 크레딧
세션 시작 시 한 번 차감됩니다. 중단되어도 이어서 진행할 수 있습니다.

공유
세션이 끝나면 최고의 AI에 투표하고, 토론을 공유하거나 검색에 노출되도록 공개할 수 있습니다.`,

  JA: `SYNODの使い方
入力欄に討論したい質問を入力し、一般または専門家モードを選んで「SYNODを開始」を押してください。討論は自動的に始まります — AIたちがラウンドを重ねながら審議していく過程をそのまま読み進めてください。

SYNODとは？
SYNODは、6つのAIが複数ラウンドにわたって討論し、最善の合意に到達するマルチAI審議エンジンです。Compare（並列比較）やArena（AIが陣営を選んでチーム戦で戦うマルチラウンドバトル）とは異なり、AIどうしが互いの主張に反論・補足・再構成しながら構造的に収束していきます。

何が違うの？
· AIがただ質問に答えるのではなく、互いに実際に反応します
· 各ラウンド後、ファシリテーターが合意事項と未解決論点を整理します
· アンチエコーチェンバー設計：投票時にAIを匿名化し、人気意見への偏りを防ぎます
· 判定議長（Claude Opus 4.8）が最終総括を執筆します

少数意見（Minority Report）
合意に達した後も、反対意見を持つAIは少数意見を提出できます。無理やり作られた合意ではなく、真の異論を保存することがSYNODの核心的な特徴です。

一般 vs 専門家モード
· 一般：わかりやすく親しみやすいトーン — 誰でも理解できます
· 専門家：より深い分析と技術的な深度、強化されたハルシネーション防止

SYNODセッションの読み方
1. オープニング — 各AIが独立した立場を表明
2. ラウンド — 同意 / 反論 / 補足 / 再構成 タグで討論
3. レッドチーム — 1つのAIが浮上しつつある合意に反論する役割を担当
4. ファシリテーター要約 — 各ラウンド後に合意スコアと未解決論点を整理
5. 最終総括 — 判定議長の結論
6. 少数意見 — 合意に含まれなかった反対意見

クレジット
· 一般モード：セッションあたり20クレジット
· 専門家モード：セッションあたり25クレジット
セッション開始時に1回引き落とされます。中断しても再開できます。

共有
セッション終了後、最も優れたAIに投票したり、討論を共有したり、検索エンジンに表示されるよう公開したりできます。`,

  'ZH-TW': `如何使用 SYNOD
在輸入框中輸入值得辯論的問題，選擇一般或專家模式，然後按下「召開 SYNOD」。辯論會自動開始 — 只需跟著閱讀 AI 們在各輪中審議的過程即可。

什麼是 SYNOD？
SYNOD 是一個多 AI 審議引擎，6 個 AI 在多輪辯論中逐步達成最佳共識。與 Compare（並行比較）或 Arena（AI 分隊進行多輪團隊對戰）不同，SYNOD 是一場結構化辯論——AI 們互相反駁、補充、重構彼此的論點，直到收斂出答案。

有何不同？
· AI 不只是回答問題，而是真正地互相回應
· 每輪結束後，主持人會整理共識與未解議題
· 反迎合設計：投票時對 AI 進行匿名處理，防止偏向熱門意見
· 裁決主席（Claude Opus 4.8）撰寫最終綜合結論

少數意見（Minority Report）
即使達成共識，持有異議的 AI 仍可提交少數意見。保留真實分歧、而非強制製造假共識，是 SYNOD 的核心特色。

一般 vs 專家模式
· 一般：易懂親切的語調——任何人都能理解
· 專家：更深入的分析與技術深度，強化防幻覺機制

如何閱讀 SYNOD 討論
1. 開場 — 各 AI 表明獨立立場
2. 輪次 — 以同意 / 質疑 / 補充 / 重構 標籤進行辯論
3. 紅隊 — 某 AI 被指定對浮現中的共識提出反論
4. 主持人摘要 — 每輪後整理共識分數與未解議題
5. 最終綜合 — 裁決主席的結論
6. 少數意見 — 未納入共識的反對觀點

點數
· 一般模式：每次討論 20 點
· 專家模式：每次討論 25 點
於討論開始時扣除一次。中斷後可繼續進行。

分享
討論結束後，可投票選出最佳 AI、分享辯論內容，或公開發布讓搜尋引擎收錄。`,

  FR: `Comment utiliser SYNOD
Saisissez une question qui mérite d'être débattue, choisissez le mode Facile ou Expert, puis cliquez sur « Lancer SYNOD ». Le débat démarre automatiquement — lisez simplement le déroulement des délibérations au fil des tours.

Qu'est-ce que SYNOD ?
SYNOD est un moteur de délibération multi-IA où 6 IA débattent d'une question sur plusieurs tours pour atteindre le meilleur consensus possible. Contrairement à Compare (réponses parallèles) ou Arena (bataille de plusieurs rounds où les IA choisissent leur camp), SYNOD est un débat structuré — les IA se contestent, se complètent et reformulent leurs arguments jusqu'à converger.

En quoi est-ce différent ?
· Les IA réagissent réellement les unes aux autres, pas seulement à votre question
· Après chaque tour, un Facilitateur résume les points de consensus et les questions ouvertes
· Conception anti-sycophantie : les IA sont anonymisées lors du vote pour éviter les biais
· Un Président du verdict (Claude Opus 4.8) rédige la synthèse finale

Rapport minoritaire (Minority Report)
Même après avoir atteint un consensus, les IA dissidentes peuvent soumettre un rapport minoritaire — préservant le vrai désaccord plutôt qu'une unanimité forcée. C'est l'une des caractéristiques fondamentales de SYNOD.

Mode Facile vs Expert
· Facile : Ton accessible et conversationnel — tout le monde peut suivre
· Expert : Analyse plus approfondie, plus technique, avec des garde-fous renforcés contre les hallucinations

Comment lire une session SYNOD
1. Ouverture — chaque IA expose sa position indépendante
2. Tours — les IA débattent avec les balises : ACCORD / CONTESTATION / COMPLÉMENT / RECADRAGE
3. ÉQUIPE ROUGE — une IA est chargée de s'opposer au consensus émergent
4. Résumé du facilitateur — score de consensus + questions ouvertes après chaque tour
5. Synthèse finale — la conclusion du Président du verdict
6. Rapport minoritaire — les positions dissidentes exclues du consensus

Crédits
· Mode Facile : 20 crédits par session
· Mode Expert : 25 crédits par session
Débité une fois au démarrage. Les sessions peuvent être reprises en cas d'interruption.

Partage
À la fin d'une session, vous pouvez voter pour la meilleure IA, partager le débat ou le publier pour qu'il soit indexé par les moteurs de recherche.`,

  AR: `كيفية استخدام SYNOD
اكتب أي سؤال يستحق النقاش في حقل الإدخال، اختر وضع العام أو الخبراء، ثم اضغط على «ابدأ SYNOD». يبدأ النقاش تلقائياً — فقط اقرأ مجريات التداول بين النماذج عبر الجولات.

ما هو SYNOD؟
SYNOD هو محرك تداول متعدد الذكاء الاصطناعي، حيث تتناقش 6 نماذج ذكاء اصطناعي عبر جولات متعددة للوصول إلى أفضل إجابة توافقية ممكنة. على عكس Compare (الردود المتوازية) أو Arena (معركة متعددة الجولات تنقسم فيها النماذج إلى فرق)، يُعدّ SYNOD نقاشاً منظّماً — تتحدى النماذج بعضها وتُكمّل وتُعيد صياغة الحجج حتى تتقارب.

ما الذي يجعله مختلفاً؟
· تتفاعل النماذج فعلياً مع بعضها، لا مع سؤالك فحسب
· بعد كل جولة، يلخّص الميسّر نقاط التوافق والقضايا المفتوحة
· تصميم مضاد للتملّق: يتم تجهيل هوية النماذج أثناء التصويت لمنع التحيّز نحو الآراء الشائعة
· يكتب رئيس الحكم (Claude Opus 4.8) التركيب النهائي

تقرير الأقلية (Minority Report)
حتى بعد التوصل إلى توافق، يمكن للنماذج المعارضة تقديم تقرير أقلية — للحفاظ على الخلاف الحقيقي بدلاً من فرض إجماع مزيّف. هذه إحدى الميزات الجوهرية في SYNOD.

الوضع العام مقابل وضع الخبراء
· العام: لهجة سهلة ومحادثاتية — يمكن للجميع المتابعة
· الخبراء: تحليل أعمق وأكثر تقنية، مع ضمانات معزّزة ضد الهلوسة

كيف تقرأ جلسة SYNOD
1. الافتتاح — يعرض كل نموذج موقفه المستقل
2. الجولات — تتناقش النماذج باستخدام تصنيفات: موافقة / اعتراض / تكملة / إعادة صياغة
3. الفريق الأحمر — يُكلَّف أحد النماذج بمعارضة التوافق الناشئ
4. ملخص الميسّر — درجة التوافق + القضايا المفتوحة بعد كل جولة
5. التركيب النهائي — استنتاج رئيس الحكم
6. تقرير الأقلية — الآراء المعارضة التي لم تُدرج في التوافق

الرصيد
· الوضع العام: 20 رصيداً لكل جلسة
· وضع الخبراء: 25 رصيداً لكل جلسة
يُخصم مرة واحدة عند بدء الجلسة. يمكن استئناف الجلسات في حال الانقطاع.

المشاركة
بعد انتهاء الجلسة، يمكنك التصويت لأفضل نموذج، ومشاركة النقاش، أو نشره علناً ليظهر في محركات البحث.`,

  ES: `Cómo usar SYNOD
Escribe cualquier pregunta que valga la pena debatir en el campo de entrada, elige el modo Fácil o Experto y pulsa «Iniciar SYNOD». El debate comienza automáticamente — solo lee el proceso de deliberación de las IAs a lo largo de las rondas.

¿Qué es SYNOD?
SYNOD es un motor de deliberación multi-IA donde 6 IAs debaten una pregunta en múltiples rondas para alcanzar la mejor respuesta consensuada posible. A diferencia de Compare (respuestas paralelas) o Arena (batalla de múltiples rondas donde las IAs eligen bando), SYNOD es un debate estructurado — las IAs se desafían, se complementan y reformulan sus argumentos hasta converger.

¿En qué se diferencia?
· Las IAs reaccionan realmente entre sí, no solo a tu pregunta
· Tras cada ronda, un Facilitador resume los puntos de consenso y los temas abiertos
· Diseño anti-adulación: las IAs se anonimizan durante la votación para evitar sesgos
· Un Presidente del veredicto (Claude Opus 4.8) redacta la síntesis final

Informe de minoría (Minority Report)
Incluso tras alcanzar consenso, las IAs disidentes pueden presentar un informe de minoría — preservando el desacuerdo genuino en lugar de forzar unanimidad falsa. Esta es una de las características fundamentales de SYNOD.

Modo Fácil vs Experto
· Fácil: Tono accesible y conversacional — cualquiera puede seguirlo
· Experto: Análisis más profundo y técnico, con salvaguardias reforzadas contra alucinaciones

Cómo leer una sesión SYNOD
1. Apertura — cada IA expone su posición independiente
2. Rondas — las IAs debaten con etiquetas: ACUERDO / IMPUGNACIÓN / COMPLEMENTO / REENCUADRE
3. EQUIPO ROJO — una IA es asignada para oponerse al consenso emergente
4. Resumen del facilitador — puntuación de consenso + temas abiertos tras cada ronda
5. Síntesis final — la conclusión del Presidente del veredicto
6. Informe de minoría — posiciones disidentes excluidas del consenso

Créditos
· Modo Fácil: 20 créditos por sesión
· Modo Experto: 25 créditos por sesión
Se descuenta una vez al inicio. Las sesiones pueden reanudarse si se interrumpen.

Compartir
Al final de una sesión, puedes votar por la mejor IA, compartir el debate o publicarlo para que los motores de búsqueda lo indexen.`,

  PT: `Como usar o SYNOD
Digite qualquer pergunta que valha a pena debater na caixa de entrada, escolha o modo Fácil ou Especialista e clique em «Iniciar SYNOD». O debate começa automaticamente — basta acompanhar o processo de deliberação das IAs ao longo das rodadas.

O que é o SYNOD?
SYNOD é um motor de deliberação multi-IA onde 6 IAs debatem uma questão em múltiplas rodadas para alcançar a melhor resposta consensual possível. Ao contrário do Compare (respostas paralelas) ou Arena (batalha de múltiplas rodadas onde as IAs escolhem seus lados), o SYNOD é um debate estruturado — as IAs se contestam, se complementam e reformulam os argumentos umas das outras até convergir.

O que o torna diferente?
· As IAs reagem umas às outras de verdade, não apenas à sua pergunta
· Após cada rodada, um Facilitador resume os pontos de consenso e as questões em aberto
· Design anti-adulação: as IAs são anonimizadas durante a votação para evitar viés em favor de opiniões populares
· Um Presidente do veredito (Claude Opus 4.8) escreve a síntese final

Relatório de Minoria (Minority Report)
Mesmo após atingir consenso, as IAs dissidentes podem apresentar um relatório de minoria — preservando o desacordo genuíno em vez de forçar unanimidade artificial. Esta é uma das características centrais do SYNOD.

Modo Fácil vs Especialista
· Fácil: Tom acessível e conversacional — qualquer pessoa pode acompanhar
· Especialista: Análise mais profunda e técnica, com salvaguardas reforçadas contra alucinações

Como ler uma sessão SYNOD
1. Abertura — cada IA expõe sua posição independente
2. Rodadas — as IAs debatem com marcadores: CONCORDO / CONTESTAÇÃO / COMPLEMENTO / REENQUADRAMENTO
3. EQUIPE VERMELHA — uma IA é designada para se opor ao consenso emergente
4. Resumo do facilitador — pontuação de consenso + questões em aberto após cada rodada
5. Síntese final — a conclusão do Presidente do veredito
6. Relatório de minoria — posições dissidentes excluídas do consenso

Créditos
· Modo Fácil: 20 créditos por sessão
· Modo Especialista: 25 créditos por sessão
Debitado uma vez no início. As sessões podem ser retomadas se interrompidas.

Compartilhar
Ao final de uma sessão, você pode votar na melhor IA, compartilhar o debate ou publicá-lo para que os mecanismos de busca o indexem.`,
}
