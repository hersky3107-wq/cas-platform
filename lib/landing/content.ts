export type Locale = "en" | "ko" | "ja" | "zh-TW";

export interface ModuleItem {
  emoji: string;
  name: string;
  desc: string;
}

export interface UseCaseItem {
  emoji: string;
  title: string;
  desc: string;
}

export interface LandingContent {
  meta: { title: string; description: string };
  hero: {
    brand: string;
    headlinePre: string;
    headlineAccent: string;
    headlinePost: string;
    subheadline: string;
    body: string;
    practical: string;
    cta: string;
  };
  modules: { sectionTitle: string; sectionSub: string; items: ModuleItem[] };
  useCases: { sectionTitle: string; items: UseCaseItem[] };
  pitch: { title: string; bullets: string[] };
  philosophy: { main: string; emphasis: string; closing: string };
  finalCta: { offer: string; button: string };
  footer: { terms: string; privacy: string; refund: string; disclaimer: string };
}

export const landingContent: Record<Locale, LandingContent> = {
  en: {
    meta: {
      title: "AIMANI — One question. Six AI minds.",
      description: "Compare ChatGPT, Claude, Gemini, Grok, DeepSeek & Mistral side by side. 30 free credits. No card required.",
    },
    hero: {
      brand: "AIMANI",
      headlinePre: "One question.",
      headlineAccent: "Six AI minds.",
      headlinePost: "Zero consensus.",
      subheadline: "Stop asking one AI. Ask all of them.",
      body: "Ask anything. Watch ChatGPT, Claude, Gemini, Grok, DeepSeek, and Mistral respond, disagree, and fight it out — live.",
      practical: "Whether you're drafting a report, making a call, or just curious — six perspectives beat one.",
      cta: "Try AIMANI Free — No card required",
    },
    modules: {
      sectionTitle: "Nine ways to experience collective AI intelligence",
      sectionSub: "New modules are on the way. Stay tuned.",
      items: [
        { emoji: "🗣️", name: "Compare", desc: "Same question. Six answers. See where they agree and where they clash." },
        { emoji: "🎭", name: "Persona", desc: "Assign each AI a role — same question, six completely different perspectives and personalities." },
        { emoji: "⚖️", name: "Panel", desc: "AIs score, vote, rank, predict, and fact-check." },
        { emoji: "⚔️", name: "Arena", desc: "9-round AI battle. Logic Battle or Street Fight. No referee." },
        { emoji: "🔧", name: "Custom", desc: "Quick questions or deep system prompts. You control the depth." },
        { emoji: "🔬", name: "DEEP", desc: "Six parallel analyses + one synthesized report." },
        { emoji: "🔮", name: "Oracle", desc: "Six AIs read your fortune. Tarot, astrology, daily reading." },
        { emoji: "🧠", name: "Mindgame", desc: "AIs deceive each other. Zombie infection. Wolf game." },
        { emoji: "🎬", name: "Stage", desc: "AI comedy shows, stand-up sets, and storytelling." },
      ],
    },
    useCases: {
      sectionTitle: "Useful when you're working. Fun when you're not.",
      items: [
        { emoji: "✍️", title: "Drafting an important email", desc: "Compare six versions side by side. Pick the best line from each." },
        { emoji: "📊", title: "Researching a big decision", desc: "Run DEEP. Six parallel analyses, one synthesized report." },
        { emoji: "🎯", title: "Stuck on a problem at work", desc: "Get six angles. One of them usually sees what you missed." },
        { emoji: "🔍", title: "Fact-checking a claim", desc: "Six AIs vote. Catch the hallucination before it costs you." },
        { emoji: "🎲", title: "Friday night, nothing to do", desc: "Watch them argue, roast each other, or read your fortune." },
        { emoji: "🃏", title: "Killing time on the commute", desc: "Play Wolf against five AIs that will lie to your face." },
      ],
    },
    pitch: {
      title: "Not your average AI platform.",
      bullets: [
        "Nine modules spanning analysis, entertainment, games, and creative storytelling — with more on the way.",
        "Six AIs with distinct personalities, debating each other by name. The friction is the product.",
        "Built to feel alive. Not another white box with a chat window.",
        "Use it for real work — comparison, deep research, fact-checking, drafting. Or don't. Either way.",
      ],
    },
    philosophy: {
      main: "Most AI tools give you a result. AIMANI gives you the full picture — the process, the friction, the disagreement, and the collective intelligence behind every answer.",
      emphasis: "For work that matters. Or for the hell of it.",
      closing: "One question. Six minds. The answer lives somewhere in the middle.",
    },
    finalCta: { offer: "🎁 30 free credits. No card required.", button: "Start for Free" },
    footer: {
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      refund: "Refund Policy",
      disclaimer: "AIMANI is an independent platform connecting multiple AI providers. Not affiliated with OpenAI, Anthropic, Google, xAI, Mistral AI, or DeepSeek.",
    },
  },

  ko: {
    meta: {
      title: "AIMANI — 하나의 질문, 여섯 개의 AI",
      description: "ChatGPT, Claude, Gemini, Grok, DeepSeek, Mistral을 동시에 비교하세요. 30 무료 크레딧. 카드 불필요.",
    },
    hero: {
      brand: "AIMANI",
      headlinePre: "하나의 질문.",
      headlineAccent: "여섯 AI의 관점.",
      headlinePost: "합의는 없다.",
      subheadline: "AI 하나에게만 묻는 건 이제 그만. 전부에게 물어봐라.",
      body: "무엇이든 물어봐라. ChatGPT, Claude, Gemini, Grok, DeepSeek, Mistral이 실시간으로 답하고, 의견이 엇갈리고, 치열하게 충돌한다.",
      practical: "보고서를 쓰거나, 중요한 결정을 내리거나, 그냥 궁금해서든 — 여섯 개의 시각이 하나보다 낫다.",
      cta: "AIMANI 무료로 시작 — 카드 불필요",
    },
    modules: {
      sectionTitle: "집단 AI 지능을 경험하는 아홉 가지 방법",
      sectionSub: "새로운 모듈이 계속 추가됩니다.",
      items: [
        { emoji: "🗣️", name: "Compare", desc: "같은 질문, 여섯 개의 답. 어디서 일치하고 어디서 충돌하는지 확인." },
        { emoji: "🎭", name: "Persona", desc: "각 AI에 역할 부여 — 같은 질문, 완전히 다른 여섯 개의 시각과 개성." },
        { emoji: "⚖️", name: "Panel", desc: "AI가 점수 매기고, 투표하고, 순위 매기고, 예측하고, 팩트체크." },
        { emoji: "⚔️", name: "Arena", desc: "9라운드 AI 배틀. 논리 배틀 또는 스트리트 파이트. 심판 없음." },
        { emoji: "🔧", name: "Custom", desc: "간단한 질문부터 깊은 시스템 프롬프트까지. 깊이는 당신이 결정." },
        { emoji: "🔬", name: "DEEP", desc: "6개 병렬 분석 + 하나의 통합 보고서." },
        { emoji: "🔮", name: "Oracle", desc: "여섯 AI가 운세를 본다. 타로, 점성술, 오늘의 운세." },
        { emoji: "🧠", name: "Mindgame", desc: "AI들이 서로 속인다. 좀비 감염. 늑대인간 게임." },
        { emoji: "🎬", name: "Stage", desc: "AI 코미디쇼, 스탠드업, 스토리텔링." },
      ],
    },
    useCases: {
      sectionTitle: "일할 때도 쓸 만하다. 놀 때도 재미있다.",
      items: [
        { emoji: "✍️", title: "중요한 이메일을 써야 할 때", desc: "여섯 버전을 나란히 비교. 각 AI의 베스트 문장을 골라라." },
        { emoji: "📊", title: "큰 결정을 앞두고 조사할 때", desc: "DEEP 실행. 6개 병렬 분석, 하나의 통합 보고서." },
        { emoji: "🎯", title: "일하다 막혔을 때", desc: "여섯 개의 시각을 얻어라. 그 중 하나는 당신이 놓친 걸 본다." },
        { emoji: "🔍", title: "정보를 팩트체크할 때", desc: "여섯 AI가 투표. 손해 보기 전에 환각을 잡아내라." },
        { emoji: "🎲", title: "금요일 밤, 할 일이 없을 때", desc: "싸우고, 놀리고, 운세 보는 걸 구경해라." },
        { emoji: "🃏", title: "출퇴근 시간을 때울 때", desc: "반드시 거짓말하는 다섯 AI와 늑대인간 게임을." },
      ],
    },
    pitch: {
      title: "평범한 AI 플랫폼이 아니다.",
      bullets: [
        "분석부터 엔터테인먼트, 게임, 창작까지 — 9개 모듈이 계속 추가된다.",
        "뚜렷한 개성을 가진 6개의 AI가 이름을 대며 토론한다. 그 충돌이 곧 제품이다.",
        "살아 있는 것처럼 느껴지게 설계됐다. 흰 채팅 창이 아니다.",
        "실제 업무에도 쓸 수 있다 — 비교, 심층 조사, 팩트체크, 초안 작성. 쓰든 말든. 상관없다.",
      ],
    },
    philosophy: {
      main: "대부분의 AI 툴은 결과만 준다. AIMANI는 전체 그림을 준다 — 과정, 충돌, 불일치, 그리고 모든 답 뒤에 있는 집단 지능.",
      emphasis: "중요한 일에서도. 그냥 재미로도.",
      closing: "하나의 질문. 여섯 개의 관점. 답은 그 어딘가에 있다.",
    },
    finalCta: { offer: "🎁 30 무료 크레딧. 카드 불필요.", button: "무료로 시작" },
    footer: {
      terms: "이용약관",
      privacy: "개인정보처리방침",
      refund: "환불정책",
      disclaimer: "AIMANI는 여러 AI 제공업체를 연결하는 독립 플랫폼입니다. OpenAI, Anthropic, Google, xAI, Mistral AI, DeepSeek와 무관합니다.",
    },
  },

  ja: {
    meta: {
      title: "AIMANI — ひとつの質問、6つのAI",
      description: "ChatGPT、Claude、Gemini、Grok、DeepSeek、Mistralを同時に比較。30クレジット無料、カード不要。",
    },
    hero: {
      brand: "AIMANI",
      headlinePre: "ひとつの質問。",
      headlineAccent: "6つのAIの答え。",
      headlinePost: "一致しない。",
      subheadline: "1つのAIに聞くのをやめよう。全部に聞いてみよう。",
      body: "何でも聞いてみよう。ChatGPT、Claude、Gemini、Grok、DeepSeek、Mistralがリアルタイムで答え、意見が食い違い、激しく衝突する。",
      practical: "レポートを書くときも、重要な判断をするときも、ただ気になっているときも——6つの視点は1つに勝る。",
      cta: "無料で試す — カード不要",
    },
    modules: {
      sectionTitle: "集合的AIインテリジェンスを体験する9つの方法",
      sectionSub: "新しいモジュールが続々と追加される予定です。",
      items: [
        { emoji: "🗣️", name: "Compare", desc: "同じ質問、6つの答え。どこで意見が合い、どこで対立するかを確認。" },
        { emoji: "🎭", name: "Persona", desc: "各AIに役割を割り当てる——同じ質問に、まったく異なる6つの視点と個性。" },
        { emoji: "⚖️", name: "Panel", desc: "AIがスコアを付け、投票し、ランキングし、予測し、ファクトチェックを行う。" },
        { emoji: "⚔️", name: "Arena", desc: "9ラウンドのAI対決。ロジックバトルかストリートファイト。審判なし。" },
        { emoji: "🔧", name: "Custom", desc: "簡単な質問から深いシステムプロンプトまで。深さはあなたが決める。" },
        { emoji: "🔬", name: "DEEP", desc: "6つの並行分析＋1つの統合レポート。" },
        { emoji: "🔮", name: "Oracle", desc: "6つのAIがあなたの運勢を占う。タロット、占星術、今日の運勢。" },
        { emoji: "🧠", name: "Mindgame", desc: "AIが互いを騙し合う。ゾンビ感染。人狼ゲーム。" },
        { emoji: "🎬", name: "Stage", desc: "AIのコメディショー、スタンダップ、ストーリーテリング。" },
      ],
    },
    useCases: {
      sectionTitle: "仕事中も使える。そうじゃないときも楽しい。",
      items: [
        { emoji: "✍️", title: "重要なメールを書くとき", desc: "6つのバージョンを並べて比較。各AIのベストな一文を選ぼう。" },
        { emoji: "📊", title: "大きな決断を調べるとき", desc: "DEEPを実行。6つの並行分析と1つの統合レポート。" },
        { emoji: "🎯", title: "仕事で行き詰まったとき", desc: "6つの視点を手に入れよう。そのうちの一つが、見落としを発見してくれる。" },
        { emoji: "🔍", title: "情報をファクトチェックしたいとき", desc: "6つのAIが投票する。損失が出る前にハルシネーションを発見しよう。" },
        { emoji: "🎲", title: "金曜の夜、何もすることがないとき", desc: "議論し、いじり合い、運勢を読む姿を眺めよう。" },
        { emoji: "🃏", title: "通勤中の暇つぶしに", desc: "必ず嘘をつく5つのAIと人狼ゲームで遊ぼう。" },
      ],
    },
    pitch: {
      title: "普通のAIプラットフォームじゃない。",
      bullets: [
        "分析からエンタメ、ゲーム、創作まで——9つのモジュールが今後も続々追加。",
        "個性を持つ6つのAIが、名前で呼び合いながら議論する。その摩擦こそが製品。",
        "生きているように感じる設計。白いチャットボックスとは違う。",
        "仕事にも使える——比較、深掘り調査、ファクトチェック、文章作成。使わなくてもいい。どちらでも。",
      ],
    },
    philosophy: {
      main: "ほとんどのAIツールは結果だけを返す。AIMANIは全体像を与える——プロセス、摩擦、不一致、そしてすべての答えの背後にある集合的知性。",
      emphasis: "大事な仕事にも。そうでなくても。",
      closing: "ひとつの質問。6つの知性。答えはその中間のどこかにある。",
    },
    finalCta: { offer: "🎁 30クレジット無料。カード不要。", button: "無料で始める" },
    footer: {
      terms: "利用規約",
      privacy: "プライバシーポリシー",
      refund: "返金ポリシー",
      disclaimer: "AIMANIは複数のAIプロバイダーを接続する独立したプラットフォームです。OpenAI、Anthropic、Google、xAI、Mistral AI、DeepSeekとは一切関係ありません。",
    },
  },

  "zh-TW": {
    meta: {
      title: "AIMANI — 一個問題，六個AI",
      description: "同時比較ChatGPT、Claude、Gemini、Grok、DeepSeek與Mistral。30點免費贈送，無需信用卡。",
    },
    hero: {
      brand: "AIMANI",
      headlinePre: "一個問題。",
      headlineAccent: "六個AI的觀點。",
      headlinePost: "零共識。",
      subheadline: "別再只問一個AI。全部都問。",
      body: "問任何問題。看ChatGPT、Claude、Gemini、Grok、DeepSeek與Mistral即時作答、意見分歧、激烈交鋒。",
      practical: "無論是在起草報告、做出重要決定，還是純粹好奇——六個觀點勝過一個。",
      cta: "免費試用 AIMANI — 無需信用卡",
    },
    modules: {
      sectionTitle: "九種體驗集體AI智能的方式",
      sectionSub: "更多模組持續推出中，敬請期待。",
      items: [
        { emoji: "🗣️", name: "Compare", desc: "同一問題，六種答案。看看哪裡一致，哪裡產生分歧。" },
        { emoji: "🎭", name: "Persona", desc: "為每個AI分配角色——同一問題，六種截然不同的觀點與個性。" },
        { emoji: "⚖️", name: "Panel", desc: "AI評分、投票、排名、預測與事實查核。" },
        { emoji: "⚔️", name: "Arena", desc: "9回合AI對決。邏輯論戰或街頭格鬥。沒有裁判。" },
        { emoji: "🔧", name: "Custom", desc: "簡單問題或深度系統提示。由你掌控深度。" },
        { emoji: "🔬", name: "DEEP", desc: "六路並行分析＋一份綜合報告。" },
        { emoji: "🔮", name: "Oracle", desc: "六個AI為你占卜。塔羅牌、星座運勢、每日指引。" },
        { emoji: "🧠", name: "Mindgame", desc: "AI互相欺騙。殭屍感染。狼人遊戲。" },
        { emoji: "🎬", name: "Stage", desc: "AI脫口秀、單人表演與故事創作。" },
      ],
    },
    useCases: {
      sectionTitle: "工作時有用。不工作時也很好玩。",
      items: [
        { emoji: "✍️", title: "撰寫重要郵件時", desc: "並排比較六個版本，從每個AI中挑選最佳句子。" },
        { emoji: "📊", title: "研究重大決策時", desc: "執行DEEP模式，六路並行分析，一份綜合報告。" },
        { emoji: "🎯", title: "工作遇到瓶頸時", desc: "獲得六個切入角度，其中一個通常能看見你遺漏的部分。" },
        { emoji: "🔍", title: "查核一項說法時", desc: "六個AI投票表決，在造成損失前抓住幻覺錯誤。" },
        { emoji: "🎲", title: "週五夜晚無所事事", desc: "看他們互相爭論、互嗆，或為你算命。" },
        { emoji: "🃏", title: "通勤途中打發時間", desc: "跟五個一定會對你說謊的AI玩狼人遊戲。" },
      ],
    },
    pitch: {
      title: "不是一般的AI平台。",
      bullets: [
        "分析、娛樂、遊戲與創意敘事，九個模組持續更新擴展中。",
        "六個各具個性的AI相互辯論，直呼其名。摩擦本身就是產品。",
        "設計上充滿生命感，不是另一個白色聊天視窗。",
        "可用於正事——比較、深度研究、事實查核、起草文件。不用也行。隨你。",
      ],
    },
    philosophy: {
      main: "大多數AI工具只給你一個結果。AIMANI給你完整的全貌——過程、摩擦、分歧，以及每個答案背後的集體智能。",
      emphasis: "用在重要的事上。或者純粹圖個爽。",
      closing: "一個問題。六個心智。答案就在某處之間。",
    },
    finalCta: { offer: "🎁 30點免費贈送。無需信用卡。", button: "免費開始" },
    footer: {
      terms: "服務條款",
      privacy: "隱私政策",
      refund: "退款政策",
      disclaimer: "AIMANI是一個連接多個AI提供商的獨立平台，與OpenAI、Anthropic、Google、xAI、Mistral AI及DeepSeek無從屬關係。",
    },
  },
};

export const LANGUAGE_OPTIONS: { code: Locale; label: string; href: string }[] = [
  { code: "en", label: "English", href: "/landing" },
  { code: "ko", label: "한국어", href: "/landing/ko" },
  { code: "ja", label: "日本語", href: "/landing/ja" },
  { code: "zh-TW", label: "繁體中文", href: "/landing/zh-TW" },
];
