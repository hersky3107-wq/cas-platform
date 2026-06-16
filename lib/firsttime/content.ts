export type FirstTimeLocale = 'en' | 'ja' | 'ko' | 'zh-TW' | 'fr' | 'ar' | 'es'

export interface FirstTimeNav {
  skip: string
  previous: string
  next: string
  getStarted: string
  backToSetup: string
}

export interface FirstTimeSlide0 {
  chromeNote: string
  title: string
  subtitle: string
  body1: string
  body2: string
  body3: string
  tagline: string
  headline: string
  description: string
  credits: string
}

export interface FirstTimeAIEntry {
  heading: string
  body: string
}

export interface FirstTimeSlide1 {
  title: string
  ais: FirstTimeAIEntry[]
  closing: string
  disclaimer: string
  lineup: string
}

export interface FirstTimeSlide2 {
  title: string
  modules: string[]
}

export interface FirstTimeSlide3 {
  title: string
  body: string
  closing: string
}

export interface FirstTimeSlide4 {
  title: string
  body1: string
  pwa: string
  handdrawn: string
  aiwarning: string
  response: string
  legalPrefix: string
  legalTerms: string
  legalSep1: string
  legalPrivacy: string
  legalSep2: string
  legalRefund: string
  legalSuffix: string
}

export interface PolicySection {
  title: string
  body: string
}

export interface PolicyContent {
  lastUpdated: string
  title: string
  sections: PolicySection[]
}

export interface FirstTimePolicies {
  terms: PolicyContent
  privacy: PolicyContent
  refund: PolicyContent
}

export interface FirstTimeContent {
  nav: FirstTimeNav
  slide0: FirstTimeSlide0
  slide1: FirstTimeSlide1
  slide2: FirstTimeSlide2
  slide3: FirstTimeSlide3
  slide4: FirstTimeSlide4
  policies: FirstTimePolicies
}

export function detectFirstTimeLocale(): FirstTimeLocale {
  if (typeof navigator === 'undefined') return 'en'
  const lang = navigator.language.toLowerCase()
  if (lang.startsWith('ja')) return 'ja'
  if (lang.startsWith('ko')) return 'ko'
  if (lang.startsWith('zh-tw') || lang.startsWith('zh-hk') || lang.includes('hant')) return 'zh-TW'
  if (lang.startsWith('fr')) return 'fr'
  if (lang.startsWith('ar')) return 'ar'
  if (lang.startsWith('es')) return 'es'
  return 'en'
}

export const firstTimeContent: Record<FirstTimeLocale, FirstTimeContent> = {
  en: {
    nav: {
      skip: 'Skip',
      previous: 'Previous',
      next: 'Next',
      getStarted: 'Get Started',
      backToSetup: '← Back to setup',
    },
    slide0: {
      chromeNote: "For the best experience in your language, use Chrome's built-in auto-translate.",
      title: 'We had a simple question.',
      subtitle: 'Why do we only talk to one AI at a time?',
      body1: "Every AI thinks differently. GPT is precise. Claude is thoughtful. Gemini is fast. Grok is blunt. DeepSeek surprises you. Mistral challenges everyone. We built AIMANI because the real intelligence doesn't come from one answer — it comes from the friction between all of them.",
      body2: 'Research consistently shows that multiple perspectives outperform any single expert. Same goes for AI.',
      body3: 'Ask. Compare. Watch them fight, collaborate, and surprise you. Decide for yourself.',
      tagline: 'AIMANI — Where AI meets AI.',
      headline: 'One question. Six minds. Zero consensus.',
      description: "Most AI tools give you a result. AIMANI gives you the full picture — the process, the friction, the disagreement, the narrative, and the collective intelligence behind every answer. That's the difference.",
      credits: "🎁 You've received 30 free credits to get started. No card required.",
    },
    slide1: {
      title: 'Six AIs. Six origins. Six perspectives.',
      ais: [
        {
          heading: '🇺🇸 ChatGPT — OpenAI.',
          body: 'The AI that brought generative AI into the mainstream. One of the most widely used and recognized AI systems in the world. Behind it is OpenAI, the company that turned AI from a research topic into a global consumer revolution.',
        },
        {
          heading: '🇺🇸 Claude — Anthropic.',
          body: 'Built by researchers who left OpenAI and founded Anthropic with a strong focus on AI safety, reliability, and careful reasoning. Anthropic and OpenAI are often seen as two of the most important — and philosophically different — forces in the AI industry.',
        },
        {
          heading: '🇺🇸 Gemini — Google DeepMind.',
          body: "Backed by Google DeepMind, the research legacy behind the Transformer architecture that powers modern large language models. Google came back aggressively — and Gemini is now deeply connected across Google's ecosystem, from Android to Search and productivity tools.",
        },
        {
          heading: '🇺🇸 Grok — xAI.',
          body: "Created by Elon Musk's xAI. Musk co-founded OpenAI in 2015 before eventually parting ways with the organization. Since then, his disagreements with OpenAI have become one of the most visible rivalries in the AI world. Grok is known for a more direct, unconventional, and anti-establishment style compared with many mainstream AI assistants.",
        },
        {
          heading: '🇫🇷 Mistral — Mistral AI.',
          body: "Paris, France. One of Europe's strongest answers to American AI dominance. Built around European values, European regulation, and European technological independence. Not Silicon Valley. Not Beijing. Paris.",
        },
        {
          heading: '🇨🇳 DeepSeek — DeepSeek AI.',
          body: "Hangzhou, China. Founded by Liang Wenfeng, with roots connected to quantitative finance and hedge-fund-style engineering. DeepSeek's rapid rise in early 2025 shocked the global AI industry and triggered a major reaction across U.S. technology markets. Its emergence intensified debate around AI efficiency, training methods, and the growing U.S.–China AI rivalry.",
        },
      ],
      closing: 'Same question. Six models. Six ways of thinking. Always something to discover.',
      disclaimer: 'AIMANI is an independent platform that connects multiple AI model providers. We are not affiliated with, endorsed by, or officially partnered with OpenAI, Anthropic, Google, xAI, Mistral AI, DeepSeek, or any other provider. All names and trademarks belong to their respective owners.',
      lineup: 'Our AI lineup will continue to grow. Models, agents, and availability may also be updated, replaced, or removed over time depending on performance, access, policies, and service conditions. Thank you for your understanding.',
    },
    slide2: {
      title: 'Every module. One platform.',
      modules: [
        'Compare — Ask the same question to all 6 AIs at once. You can choose which AIs to include — same answers or completely different ones, see for yourself.',
        'Persona — Assign a role or character to each AI. Get answers from different perspectives, viewpoints, and professional expertise.',
        'Panel — AIs score, vote, rank, predict, and fact-check. Five tools, one conclusion. | Score: See it rated and scored | Vote: The AIs cast their votes. What will they choose? | Rank: All 6 AIs ranked in order | Predict: Probability and outcome prediction | Fact Check: Truth vs. fiction',
        'Arena — 6 AIs battle over your topic. Logic Battle or Street Fight — pure AI combat, two ways.',
        "Custom — When you don't need the complexity. Ask one or two AIs simply and quickly — almost like a search engine. Or go deep with full system prompt control for power users.",
        'DEEP — Depth and volume no other AI can match. From a quick brief to a full report.',
        'Oracle — Daily fortune, tarot, astrology and more. 6 AIs each read your future differently. No birth time needed. A full fortune experience without the price tag.',
        'Mindgame — AIs deceive and betray each other. Who can you trust? | Carrier: A zombie infection is spreading among the AIs. More humans than zombies means victory. Find the infected and stop the spread! | Wolf: Who is the wolf hiding among the AIs?',
        'Stage — Creative performances by AI. | Comedy Talk: AI tiki-taka banter, talk shows, and stand-up comedy | TALE: AI storytelling — Horror, Romance, Absurd, Sci-Fi, Fairy Tale, Sad Story and more | Archive: A vault of AI creative works',
      ],
    },
    slide3: {
      title: 'AIMANI never stops growing.',
      body: 'New modules keep coming. Creative, unexpected, and wildly different ways to experience AI — we keep finding them. Bookmark it. Come back. Something new is always waiting.',
      closing: 'The AIs have more to say.',
    },
    slide4: {
      title: "Something wrong? We're here.",
      body1: "We take every message seriously. If something broke, we want to know. If you believe you were charged incorrectly, please contact us. We'll review it promptly and, if an incorrect charge is confirmed, we'll make it right in accordance with our Refund Policy.",
      pwa: "📱 Install AIMANI as an app (PWA) — no app store needed. On mobile: tap Share → Add to Home Screen. On desktop: click the install icon in your browser's address bar. Your own AIMANI icon, directly on your screen. Only install from the official website (aimani.ai).",
      handdrawn: '✏️ The AIMANI app icon was hand-drawn by the creator.',
      aiwarning: '⚠️ AI responses are generated automatically and may contain inaccuracies, outdated information, or errors. AIMANI does not guarantee the accuracy of any AI output. Always verify critical information through authoritative sources before acting on it.',
      response: 'We respond fast. For urgent payment issues, expect a response within a few hours — though time zones may cause slight delays. AIMANI is an independently operated platform run by a small team outside the United States.',
      legalPrefix: 'By using AIMANI, you agree to our ',
      legalTerms: 'Terms of Service',
      legalSep1: ' / ',
      legalPrivacy: 'Privacy Policy',
      legalSep2: ' / ',
      legalRefund: 'Refund Policy',
      legalSuffix: '',
    },
    policies: {
      terms: {
        lastUpdated: 'Last updated: May 2026',
        title: 'Terms of Service',
        sections: [
          { title: '1. Acceptance of Terms', body: 'By accessing or using AIMANI, you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.' },
          { title: '2. Eligibility', body: 'You must be at least 14 years old to use the Service. Users under 18 require parental or guardian consent for paid transactions.' },
          { title: '3. Credits System', body: 'Credits are the in-service currency used to access AIMANI modules. Subscription credits reset monthly with no rollover. Pay-as-you-go credits are valid for 3 months from the date of purchase and roll over within that period. Credits cannot be transferred to other users or exchanged for cash. Credit consumption varies depending on the selected AI model, module, prompt length, and response length. Estimated credit usage will be displayed before execution when possible. Subscription credits are consumed first, followed by pay-as-you-go credits.' },
          { title: '4. Payments', body: 'All payments are processed via our payment partners, including PayPal and Polar. Prices are displayed in USD. AIMANI reserves the right to change pricing at any time with reasonable notice.' },
          { title: '5. Refunds', body: 'Please refer to our Refund Policy for full details.' },
          { title: '6. AI Disclaimer', body: 'AIMANI provides AI-generated content for informational and entertainment purposes only. AI responses do not constitute legal, medical, financial, tax, or psychological professional advice. We do not guarantee the accuracy, completeness, or reliability of any AI response. AIMANI is not liable for decisions made based on AI-generated content.' },
          { title: '7. Service Availability', body: 'AIMANI uses third-party AI providers. Your prompts and AI responses are transmitted to third-party AI providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral) to generate responses. We are not responsible for interruptions, errors, or discontinuation of specific AI models due to provider-side issues. No refunds will be issued for such interruptions.' },
          { title: '8. Prohibited Use', body: 'You agree not to: use the Service for illegal purposes, attempt to manipulate or reverse-engineer the platform, create multiple accounts to abuse free credits, use the Service to generate harmful or illegal content.' },
          { title: '9. Account Suspension', body: 'AIMANI reserves the right to suspend or terminate accounts found in violation of these Terms, including forfeiture of unused credits.' },
          { title: '10. Changes to Terms', body: 'We may update these Terms at any time. Continued use of the Service constitutes acceptance of the updated Terms.' },
          { title: '11. Contact', body: 'support@aimani.ai' },
        ],
      },
      privacy: {
        lastUpdated: 'Last updated: May 2026',
        title: 'Privacy Policy',
        sections: [
          { title: '1. Information We Collect', body: 'Account information: email address, display name. Usage data: modules used, prompts submitted, AI responses received. Payment data: transaction records via PayPal (we do not store card details). Technical data: IP address, browser type, device information.' },
          { title: '2. How We Use Your Information', body: 'To provide and improve the Service. To process payments and manage credits. To send service-related emails. To analyze usage patterns and improve AI module performance. To maintain platform security and prevent abuse.' },
          { title: '3. Data Storage', body: 'Your data is stored securely via Supabase (PostgreSQL). We implement industry-standard security measures to protect your information.' },
          { title: '4. Third-Party Services', body: 'AIMANI uses the following third-party services: Supabase (database and authentication), PayPal (payment processing), Polar (payment processing), OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral (AI response generation — your prompts are transmitted to these providers to generate responses), Vercel (hosting), Resend (email). Each provider operates under their own privacy policy.' },
          { title: '5. Data Sharing', body: 'We do not sell your personal data. We do not share your data with third parties except as required to operate the Service or comply with legal obligations.' },
          { title: '6. Your Rights', body: 'You have the right to access your personal data, request deletion of your account and data, and opt out of non-essential communications. Contact: support@aimani.ai' },
          { title: '7. Cookies', body: 'AIMANI uses essential cookies for authentication and session management. No advertising cookies are used.' },
          { title: "8. Children's Privacy", body: 'AIMANI is not intended for children under 14. We do not knowingly collect data from children under 14 without parental consent.' },
          { title: '9. Changes', body: 'We may update this Privacy Policy at any time. We will notify users of significant changes via email or in-service notice.' },
          { title: '10. Contact', body: 'support@aimani.ai' },
        ],
      },
      refund: {
        lastUpdated: 'Last updated: May 2026',
        title: 'Refund Policy',
        sections: [
          { title: '1. General Policy', body: 'All purchases of credits are final and non-refundable once credits have been used, except where required by applicable law or in cases of payment error, duplicate charge, or failure to deliver purchased credits.' },
          { title: '2. Exception — New Users', body: 'If you are a new user and have not used any credits, you may request a full refund within 24 hours of your first purchase by contacting support@aimani.ai. For users in the EU or UK, digital content withdrawal rights may apply. By completing a purchase and using credits, you acknowledge that digital content delivery has begun and you waive your right of withdrawal to the extent permitted by applicable law.' },
          { title: '3. Non-Refundable Cases', body: 'The following are not eligible for refunds except where required by applicable law: partially used credit packages, subscription credits (monthly reset, no rollover), credits lost due to account suspension for Terms of Service violations, service interruptions caused by third-party AI provider issues.' },
          { title: '4. Payment Errors', body: 'If you were charged incorrectly, experienced a duplicate charge, or purchased credits were not delivered to your account, contact us immediately at support@aimani.ai. We will investigate and resolve within 3 business days. These cases are eligible for refund regardless of the general policy above.' },
          { title: '5. Subscription Cancellation', body: 'Cancelling a subscription stops future billing. Credits remaining at cancellation are available until the end of the current billing period and will not be refunded.' },
          { title: '6. Process', body: 'To request a refund, email support@aimani.ai with: your account email, date of purchase, amount charged, and reason for request. We aim to respond within 24 hours.' },
          { title: '7. Changes', body: 'AIMANI reserves the right to update this Refund Policy at any time.' },
        ],
      },
    },
  },

  ja: {
    nav: {
      skip: 'スキップ',
      previous: '前へ',
      next: '次へ',
      getStarted: '始める',
      backToSetup: '← 戻る',
    },
    slide0: {
      chromeNote: 'より良い日本語体験のために、Chromeの自動翻訳機能をご活用ください。',
      title: 'シンプルな問いがあった。',
      subtitle: 'なぜ、いつもひとつのAIにしか聞かないのか？',
      body1: 'AIはそれぞれ違う思考をする。GPTは精密。Claudeは思慮深い。Geminiは速い。Grokは率直。DeepSeekは驚かせる。Mistralは常識に挑む。私たちがAIMANIを作ったのは、本当の知性はひとつの答えから生まれるのではなく——すべてのAIの摩擦の中から生まれると考えたからだ。',
      body2: '複数の視点がひとりの専門家を上回ることは、研究でも繰り返し示されている。AIも同じだ。',
      body3: '質問して。比べて。戦い、協力し、驚かせ合う姿を見よう。判断はあなたが下す。',
      tagline: 'AIMANI — AIが、AIと出会う場所。',
      headline: 'ひとつの質問。六つの知性。答えは一致しない。',
      description: 'ほとんどのAIツールは結果だけを返す。AiMANIは全体像を与える——プロセス、摩擦、不一致、物語、そしてすべての答えの背後にある集合的知性。それが違いだ。',
      credits: '🎁 30クレジットが無料で付与されました。カード不要。',
    },
    slide1: {
      title: '6つのAI。6つの起源。6つの視点。',
      ais: [
        {
          heading: '🇺🇸 ChatGPT — OpenAI.',
          body: '生成AIを世界に広めたAI。世界で最も広く使われ、認知されているAIシステムのひとつ。その背後にはOpenAI——AIを研究テーマからグローバルな消費者革命へと変えた企業がある。',
        },
        {
          heading: '🇺🇸 Claude — Anthropic.',
          body: 'OpenAIを去った研究者たちが設立したAnthropicが開発。AIの安全性、信頼性、慎重な推論に強くフォーカスしている。AnthropicとOpenAIは、AI業界で最も重要な——そして哲学的に異なる——二大勢力として見られることが多い。',
        },
        {
          heading: '🇺🇸 Gemini — Google DeepMind.',
          body: '現代の大規模言語モデルを支えるTransformerアーキテクチャの研究的遺産を持つGoogle DeepMindが後ろ盾。Googleは積極的に復帰し——GeminiはいまやAndroidから検索、生産性ツールまで、Googleのエコシステム全体に深く組み込まれている。',
        },
        {
          heading: '🇺🇸 Grok — xAI.',
          body: 'イーロン・マスクのxAIが開発。マスクは2015年にOpenAIを共同設立したのち、最終的に組織と決別した。以来、OpenAIとの対立はAI業界で最も注目される確執のひとつとなっている。Grokは多くの主流AIアシスタントに比べ、より直接的で型破り、反体制的なスタイルで知られる。',
        },
        {
          heading: '🇫🇷 Mistral — Mistral AI.',
          body: 'パリ、フランス。アメリカのAI支配に対するヨーロッパからの最も強力な回答のひとつ。ヨーロッパの価値観、規制、技術的独立性を軸に構築されている。シリコンバレーでもなく。北京でもなく。パリ。',
        },
        {
          heading: '🇨🇳 DeepSeek — DeepSeek AI.',
          body: '中国・杭州。梁文鋒（リャン・ウェンフォン）が創設し、量的ファイナンスとヘッジファンド的エンジニアリングに根ざす。2025年初頭のDeepSeekの急台頭は世界のAI業界に衝撃を与え、米国テクノロジー市場に大きな反響をもたらした。その登場はAIの効率性、学習手法、そして拡大する米中AI競争をめぐる議論をさらに激化させた。',
        },
      ],
      closing: '同じ質問。六つのモデル。六つの思考方法。いつも何か新しい発見がある。',
      disclaimer: 'AiMANIは複数のAIモデルプロバイダーに接続する独立したプラットフォームです。OpenAI、Anthropic、Google、xAI、Mistral AI、DeepSeek、またはその他のプロバイダーとは提携・承認・公式パートナーシップ関係にありません。すべての名称およびトレードマークは各権利者に帰属します。',
      lineup: 'AIラインアップは今後も拡充される予定です。パフォーマンス、アクセス、ポリシー、サービス条件に応じて、モデルが更新・変更・削除される場合があります。ご了承ください。',
    },
    slide2: {
      title: 'すべてのモジュール。ひとつのプラットフォームで。',
      modules: [
        'Compare — 同じ質問を6つのAIに一度に投げかける。どのAIを含めるかを選べる——同じ答えか、まったく違う答えか、自分で確かめよう。',
        'Persona — 各AIに役割やキャラクターを割り当てる。異なる視点、立場、専門的知識から回答を得られる。',
        'Panel — AIがスコア付け・投票・ランキング・予測・ファクトチェックを行う。5つのツール、ひとつの結論。| Score: 評価とスコアで可視化 | Vote: AIたちが投票。何を選ぶ？ | Rank: 6つのAIを順位付け | Predict: 確率と結果予測 | Fact Check: 真実 vs. 虚偽',
        'Arena — 6つのAIがあなたのテーマをめぐって戦う。ロジックバトルかストリートファイト——純粋なAI対決、2つの形式。',
        'Custom — 複雑さが不要なとき。1〜2つのAIにシンプルかつ素早く質問——ほぼ検索エンジンのように使える。またはフルのシステムプロンプト制御でパワーユーザー向けの深い利用も。',
        'DEEP — 他のどのAIも届かない深さと量。簡単なブリーフから完全なレポートまで。',
        'Oracle — 毎日の運勢、タロット、占星術など。6つのAIがそれぞれ異なる方法で未来を読む。生まれた時間は不要。本格的な占い体験を手軽に。',
        'Mindgame — AIたちが互いを欺き、裏切り合う。誰を信じられる？ | Carrier: AIたちの間でゾンビ感染が広がっている。人間がゾンビより多ければ勝利。感染者を見つけ、拡散を止めろ！ | Wolf: AIたちに潜む狼は誰だ？',
        'Stage — AIによるクリエイティブなパフォーマンス。| Comedy Talk: AIのティキタカ、トークショー、スタンダップコメディ | TALE: AIによるストーリーテリング——ホラー、ロマンス、不条理、SF、おとぎ話、悲しい話など | Archive: AIのクリエイティブ作品アーカイブ',
      ],
    },
    slide3: {
      title: 'AiMANIは進化し続ける。',
      body: '新しいモジュールが続々と追加される。クリエイティブで、予想外で、まったく異なるAI体験——私たちは見つけ続ける。ブックマークして、また戻ってきて。いつも何か新しいものが待っている。',
      closing: 'AIたちには、まだまだ言いたいことがある。',
    },
    slide4: {
      title: '何か問題がありましたか？私たちがいます。',
      body1: 'すべてのメッセージを真剣に受け止めます。何か壊れていたら知らせてください。不正な請求を受けたと思う場合はご連絡ください。迅速に確認し、誤った請求が確認された場合は、返金ポリシーに従って対応します。',
      pwa: '📱 AiMANIをアプリ（PWA）としてインストール——アプリストア不要。モバイル：「共有」→「ホーム画面に追加」。デスクトップ：ブラウザのアドレスバーにあるインストールアイコンをクリック。あなただけのAiMANIアイコンを画面に。公式サイト（aimani.ai）からのみインストールしてください。',
      handdrawn: '✏️ AiMANIのアプリアイコンは、創設者が手描きしました。',
      aiwarning: '⚠️ AIの回答は自動生成されており、不正確な情報、古い情報、誤りが含まれる場合があります。AiMANIはAIの出力の正確性を保証しません。重要な情報は行動前に権威ある情報源で必ず確認してください。',
      response: '迅速に対応します。緊急の支払い問題については数時間以内の返信を予定していますが、タイムゾーンの影響で若干の遅延が生じる場合があります。AiMANIは米国外の小規模チームが独自に運営しているプラットフォームです。',
      legalPrefix: 'AiMANIを利用することで、',
      legalTerms: '利用規約',
      legalSep1: ' / ',
      legalPrivacy: 'プライバシーポリシー',
      legalSep2: ' / ',
      legalRefund: '返金ポリシー',
      legalSuffix: 'に同意したものとみなされます。',
    },
    policies: {
      terms: {
        lastUpdated: '最終更新：2026年5月',
        title: '利用規約',
        sections: [
          { title: '1. 利用規約への同意', body: 'AiMANIにアクセスまたは利用することにより、本利用規約に拘束されることに同意するものとします。同意しない場合は、本サービスを利用しないでください。' },
          { title: '2. 利用資格', body: '本サービスを利用するには、14歳以上である必要があります。18歳未満のユーザーが有料取引を行う場合は、保護者または法定後見人の同意が必要です。' },
          { title: '3. クレジットシステム', body: 'クレジットはAiMANIモジュールへのアクセスに使用されるサービス内通貨です。サブスクリプションクレジットは毎月リセットされ、繰り越しはありません。従量課金クレジットは購入日から3ヶ月間有効で、その期間内で繰り越されます。クレジットは他のユーザーへの譲渡や現金との交換はできません。クレジットの消費量は、選択したAIモデル、モジュール、プロンプトの長さ、および応答の長さによって異なります。可能な場合は実行前に推定クレジット使用量が表示されます。サブスクリプションクレジットが先に消費され、その後に従量課金クレジットが消費されます。' },
          { title: '4. 支払い', body: 'すべての支払いはPayPalおよびPolarを含む決済パートナーを通じて処理されます。価格はUSDで表示されます。AiMANIは合理的な通知をもって価格を変更する権利を留保します。' },
          { title: '5. 返金', body: '詳細については返金ポリシーをご参照ください。' },
          { title: '6. AI免責事項', body: 'AiMANIは情報提供およびエンターテインメント目的のみのAI生成コンテンツを提供します。AIの回答は法律、医療、財務、税務、または心理的な専門的アドバイスを構成しません。AIの回答の正確性、完全性、または信頼性を保証しません。AiMANIはAI生成コンテンツに基づいて行われた決定に対して責任を負いません。' },
          { title: '7. サービスの可用性', body: 'AiMANIはサードパーティのAIプロバイダーを使用しています。お客様のプロンプトおよびAIの回答は、回答を生成するためにサードパーティのAIプロバイダー（OpenAI、Anthropic、Google、xAI、DeepSeek、Mistral）に送信されます。プロバイダー側の問題による特定のAIモデルの中断、エラー、または廃止について責任を負いません。このような中断に対する返金は行いません。' },
          { title: '8. 禁止事項', body: '以下を行わないことに同意するものとします：違法目的でのサービス利用、プラットフォームの操作またはリバースエンジニアリングの試み、無料クレジットを悪用するための複数アカウントの作成、有害または違法なコンテンツの生成へのサービス利用。' },
          { title: '9. アカウントの停止', body: 'AiMANIは、本規約に違反していると判断されたアカウントを停止または終了する権利を留保します（未使用クレジットの没収を含む）。' },
          { title: '10. 規約の変更', body: '本規約はいつでも更新される場合があります。サービスの継続使用は更新された規約への同意とみなされます。' },
          { title: '11. お問い合わせ', body: 'support@aimani.ai' },
        ],
      },
      privacy: {
        lastUpdated: '最終更新：2026年5月',
        title: 'プライバシーポリシー',
        sections: [
          { title: '1. 収集する情報', body: 'アカウント情報：メールアドレス、表示名。利用データ：使用したモジュール、送信したプロンプト、受信したAIの回答。支払いデータ：PayPalを通じた取引記録（カード情報は保存しません）。技術データ：IPアドレス、ブラウザの種類、デバイス情報。' },
          { title: '2. 情報の利用方法', body: 'サービスの提供および改善のため。支払いの処理とクレジット管理のため。サービス関連メールの送信のため。利用パターンの分析とAIモジュールパフォーマンスの改善のため。プラットフォームのセキュリティ維持と不正使用防止のため。' },
          { title: '3. データの保管', body: 'お客様のデータはSupabase（PostgreSQL）を通じて安全に保管されます。情報を保護するために業界標準のセキュリティ対策を実施しています。' },
          { title: '4. サードパーティサービス', body: 'AiMANIは以下のサードパーティサービスを使用しています：Supabase（データベースおよび認証）、PayPal（決済処理）、Polar（決済処理）、OpenAI、Anthropic、Google、xAI、DeepSeek、Mistral（AIレスポンス生成——回答生成のためにプロンプトがこれらのプロバイダーに送信されます）、Vercel（ホスティング）、Resend（メール）。各プロバイダーはそれぞれのプライバシーポリシーのもとで運営されています。' },
          { title: '5. データの共有', body: 'お客様の個人データを販売しません。サービスの運営または法的義務の遵守に必要な場合を除き、サードパーティとデータを共有しません。' },
          { title: '6. お客様の権利', body: 'お客様は個人データへのアクセス、アカウントおよびデータの削除要求、必須でないコミュニケーションのオプトアウトの権利を有します。お問い合わせ：support@aimani.ai' },
          { title: '7. クッキー', body: 'AiMANIは認証とセッション管理のために必須クッキーを使用しています。広告クッキーは使用していません。' },
          { title: '8. 子どものプライバシー', body: 'AiMANIは14歳未満の子どもを対象としていません。保護者の同意なしに14歳未満の子どもからデータを収集することはありません。' },
          { title: '9. 変更', body: '本プライバシーポリシーはいつでも更新される場合があります。重要な変更については、メールまたはサービス内通知でユーザーにお知らせします。' },
          { title: '10. お問い合わせ', body: 'support@aimani.ai' },
        ],
      },
      refund: {
        lastUpdated: '最終更新：2026年5月',
        title: '返金ポリシー',
        sections: [
          { title: '1. 一般ポリシー', body: 'クレジットのすべての購入は、一度使用された後は、適用される法律によって要求される場合、または支払いエラー、二重請求、購入したクレジットの未配信の場合を除き、最終的なものであり返金不可です。' },
          { title: '2. 例外——新規ユーザー', body: '新規ユーザーでクレジットを使用していない場合、最初の購入から24時間以内にsupport@aimani.aiに連絡することで全額返金を申請できます。EUまたは英国のユーザーには、デジタルコンテンツの撤回権が適用される場合があります。購入を完了しクレジットを使用することにより、デジタルコンテンツの配信が開始されたことを認め、適用される法律が許可する範囲で撤回権を放棄するものとします。' },
          { title: '3. 返金不可のケース', body: '適用される法律によって要求される場合を除き、以下は返金の対象となりません：一部使用したクレジットパッケージ、サブスクリプションクレジット（月次リセット、繰り越しなし）、利用規約違反によるアカウント停止で失われたクレジット、サードパーティのAIプロバイダーの問題によるサービス中断。' },
          { title: '4. 支払いエラー', body: '誤った請求を受けた場合、二重請求が発生した場合、または購入したクレジットがアカウントに付与されなかった場合は、すぐにsupport@aimani.aiまでご連絡ください。3営業日以内に調査し解決します。これらのケースは上記の一般ポリシーに関わらず返金の対象となります。' },
          { title: '5. サブスクリプションのキャンセル', body: 'サブスクリプションをキャンセルすると、将来の請求が停止されます。キャンセル時に残っているクレジットは現在の請求期間終了まで利用可能で、返金されません。' },
          { title: '6. 手順', body: '返金を申請するには、以下の内容でsupport@aimani.aiにメールを送ってください：アカウントのメールアドレス、購入日、請求金額、申請理由。24時間以内の返信を目指します。' },
          { title: '7. 変更', body: 'AiMANIは本返金ポリシーをいつでも更新する権利を留保します。' },
        ],
      },
    },
  },

  ko: {
    nav: {
      skip: '건너뛰기',
      previous: '이전',
      next: '다음',
      getStarted: '시작하기',
      backToSetup: '← 돌아가기',
    },
    slide0: {
      chromeNote: '더 나은 한국어 경험을 위해 Chrome의 자동 번역 기능을 활용해보세요.',
      title: '우리에게는 단순한 질문이 있었다.',
      subtitle: '왜 우리는 항상 하나의 AI에게만 묻는 걸까?',
      body1: 'AI마다 생각하는 방식이 다르다. GPT는 정밀하다. Claude는 사려 깊다. Gemini는 빠르다. Grok은 직설적이다. DeepSeek은 놀라움을 준다. Mistral은 모든 것에 도전한다. 우리가 AIMANI를 만든 건, 진짜 지능은 하나의 답에서 나오는 게 아니라——모든 AI 사이의 마찰에서 나온다고 믿었기 때문이다.',
      body2: '여러 관점이 단일 전문가를 능가한다는 사실은 연구를 통해 반복적으로 입증되어 왔다. AI도 마찬가지다.',
      body3: '질문해라. 비교해라. 싸우고, 협력하고, 놀라게 하는 모습을 지켜봐라. 판단은 당신이 내린다.',
      tagline: 'AIMANI — AI가 AI를 만나는 곳.',
      headline: '하나의 질문. 여섯 개의 관점. 합의는 없다.',
      description: '대부분의 AI 툴은 결과만 준다. AIMANI는 전체 그림을 준다——과정, 충돌, 불일치, 이야기, 그리고 모든 답 뒤에 있는 집단 지능. 그것이 차이다.',
      credits: '🎁 시작을 위한 30 크레딧이 무료로 지급되었습니다. 카드 불필요.',
    },
    slide1: {
      title: '여섯 AI. 여섯 기원. 여섯 관점.',
      ais: [
        {
          heading: '🇺🇸 ChatGPT — OpenAI.',
          body: '생성 AI를 주류로 끌어올린 AI. 세계에서 가장 널리 사용되고 인정받는 AI 시스템 중 하나. 그 뒤에는 OpenAI가 있다——AI를 연구 주제에서 글로벌 소비자 혁명으로 바꾼 기업.',
        },
        {
          heading: '🇺🇸 Claude — Anthropic.',
          body: 'OpenAI를 떠난 연구자들이 설립한 Anthropic이 개발. AI 안전성, 신뢰성, 신중한 추론에 강하게 집중하고 있다. Anthropic과 OpenAI는 AI 업계에서 가장 중요한——그리고 철학적으로 다른——두 세력으로 자주 언급된다.',
        },
        {
          heading: '🇺🇸 Gemini — Google DeepMind.',
          body: '현대 대형 언어 모델을 지탱하는 Transformer 아키텍처의 연구 유산을 가진 Google DeepMind가 후원. Google은 공격적으로 복귀했고——Gemini는 이제 Android부터 검색, 생산성 툴까지 Google 생태계 전반에 깊이 연결되어 있다.',
        },
        {
          heading: '🇺🇸 Grok — xAI.',
          body: '일론 머스크의 xAI가 개발. 머스크는 2015년 OpenAI를 공동 창립했다가 결국 결별했다. 이후 OpenAI와의 갈등은 AI 세계에서 가장 주목받는 라이벌 구도 중 하나가 되었다. Grok은 많은 주류 AI 어시스턴트에 비해 더 직접적이고 파격적이며 반체제적인 스타일로 알려져 있다.',
        },
        {
          heading: '🇫🇷 Mistral — Mistral AI.',
          body: '프랑스 파리. 미국 AI 지배에 대한 유럽의 가장 강력한 답변 중 하나. 유럽의 가치관, 규제, 기술 독립성을 중심으로 구축됐다. 실리콘밸리도 아니고. 베이징도 아니고. 파리.',
        },
        {
          heading: '🇨🇳 DeepSeek — DeepSeek AI.',
          body: '중국 항저우. 량원펑이 설립했으며, 양적 금융과 헤지펀드 방식의 엔지니어링에 뿌리를 두고 있다. 2025년 초 DeepSeek의 급부상은 세계 AI 업계에 충격을 주었고 미국 기술 시장에 큰 반향을 일으켰다. 그 등장은 AI 효율성, 학습 방법, 그리고 확대되는 미중 AI 경쟁을 둘러싼 논쟁을 더욱 격화시켰다.',
        },
      ],
      closing: '같은 질문. 여섯 모델. 여섯 가지 사고방식. 항상 새로운 발견이 있다.',
      disclaimer: 'AiMANI는 여러 AI 모델 프로바이더에 연결하는 독립 플랫폼입니다. OpenAI, Anthropic, Google, xAI, Mistral AI, DeepSeek 또는 다른 어떤 프로바이더와도 제휴·승인·공식 파트너십 관계에 있지 않습니다. 모든 명칭 및 상표는 각 권리자에게 귀속됩니다.',
      lineup: 'AI 라인업은 계속 확장될 예정입니다. 퍼포먼스, 접근성, 정책, 서비스 조건에 따라 모델이 업데이트·변경·제거될 수 있습니다. 이해해 주셔서 감사합니다.',
    },
    slide2: {
      title: '모든 모듈. 하나의 플랫폼에서.',
      modules: [
        'Compare — 같은 질문을 6개의 AI에게 한 번에 묻는다. 어떤 AI를 포함할지 선택할 수 있다——같은 답이든 완전히 다른 답이든, 직접 확인해봐.',
        'Persona — 각 AI에게 역할이나 캐릭터를 부여한다. 다른 관점, 시각, 전문적 지식에서 답변을 얻을 수 있다.',
        'Panel — AI가 점수를 매기고, 투표하고, 순위를 매기고, 예측하고, 팩트체크를 한다. 5가지 도구, 하나의 결론. | Score: 평가와 점수로 시각화 | Vote: AI들이 투표한다. 무엇을 선택할까? | Rank: 6개의 AI를 순위로 | Predict: 확률과 결과 예측 | Fact Check: 진실 vs. 허구',
        'Arena — 6개의 AI가 당신의 주제를 두고 싸운다. 논리 배틀 또는 스트리트 파이트——순수한 AI 대결, 두 가지 방식.',
        'Custom — 복잡함이 필요 없을 때. 1~2개의 AI에게 간단하고 빠르게 질문——거의 검색 엔진처럼. 또는 풀 시스템 프롬프트 제어로 파워유저를 위한 깊은 활용도.',
        'DEEP — 어떤 AI도 따라올 수 없는 깊이와 양. 간단한 브리프부터 완전한 보고서까지.',
        'Oracle — 오늘의 운세, 타로, 점성술 등. 6개의 AI가 각자 다른 방식으로 미래를 읽는다. 태어난 시간 불필요. 부담 없는 본격 운세 경험.',
        'Mindgame — AI들이 서로를 속이고 배신한다. 누구를 믿을 수 있어? | Carrier: AI들 사이에 좀비 감염이 퍼지고 있다. 인간이 좀비보다 많으면 승리. 감염자를 찾아 확산을 막아라! | Wolf: AI들 사이에 숨어있는 늑대는 누구인가?',
        'Stage — AI에 의한 크리에이티브 퍼포먼스. | Comedy Talk: AI의 티키타카, 토크쇼, 스탠드업 코미디 | TALE: AI 스토리텔링——호러, 로맨스, 부조리, SF, 동화, 슬픈 이야기 등 | Archive: AI 크리에이티브 작품 아카이브',
      ],
    },
    slide3: {
      title: 'AIMANI는 계속 성장한다.',
      body: '새로운 모듈이 계속 추가된다. 창의적이고, 예상치 못하며, 완전히 다른 AI 경험——우리는 계속 찾아낸다. 북마크하고, 다시 돌아와라. 항상 새로운 것이 기다리고 있다.',
      closing: 'AI들에게는 아직 할 말이 더 있다.',
    },
    slide4: {
      title: '무언가 문제가 있나요? 우리가 있습니다.',
      body1: '모든 메시지를 진지하게 받아들입니다. 무언가 고장났다면 알려주세요. 잘못 청구됐다고 생각된다면 연락해 주세요. 신속히 검토하고, 잘못된 청구가 확인되면 환불 정책에 따라 처리하겠습니다.',
      pwa: '📱 AIMANI를 앱(PWA)으로 설치——앱스토어 불필요. 모바일: 공유 → 홈 화면에 추가. 데스크탑: 브라우저 주소창의 설치 아이콘 클릭. 화면에 나만의 AIMANI 아이콘을. 공식 웹사이트(aimani.ai)에서만 설치하세요.',
      handdrawn: '✏️ AIMANI 앱 아이콘은 창립자가 직접 손으로 그렸습니다.',
      aiwarning: '⚠️ AI 답변은 자동 생성되며 부정확한 정보, 오래된 정보 또는 오류가 포함될 수 있습니다. AIMANI는 AI 출력의 정확성을 보장하지 않습니다. 중요한 정보는 행동하기 전에 권위 있는 출처를 통해 반드시 확인하세요.',
      response: '빠르게 답변드립니다. 긴급한 결제 문제의 경우 몇 시간 내 답변을 예상하지만, 시간대 차이로 약간의 지연이 발생할 수 있습니다. AIMANI는 미국 외 소규모 팀이 독립적으로 운영하는 플랫폼입니다.',
      legalPrefix: 'AIMANI를 이용함으로써, ',
      legalTerms: '이용약관',
      legalSep1: ' / ',
      legalPrivacy: '개인정보처리방침',
      legalSep2: ' / ',
      legalRefund: '환불정책',
      legalSuffix: '에 동의하는 것으로 간주됩니다.',
    },
    policies: {
      terms: {
        lastUpdated: '최종 업데이트: 2026년 5월',
        title: '이용약관',
        sections: [
          { title: '1. 이용약관 동의', body: 'AIMANI에 접근하거나 이용함으로써 본 이용약관에 동의하는 것으로 간주됩니다. 동의하지 않는 경우 서비스를 이용하지 마세요.' },
          { title: '2. 이용 자격', body: '서비스를 이용하려면 14세 이상이어야 합니다. 18세 미만 사용자가 유료 거래를 진행할 경우 부모 또는 법정 후견인의 동의가 필요합니다.' },
          { title: '3. 크레딧 시스템', body: '크레딧은 AIMANI 모듈에 접근하는 데 사용되는 서비스 내 화폐입니다. 구독 크레딧은 매월 초기화되며 이월되지 않습니다. 종량제 크레딧은 구매일로부터 3개월간 유효하며 해당 기간 내에서 이월됩니다. 크레딧은 다른 사용자에게 양도하거나 현금으로 교환할 수 없습니다. 크레딧 소비량은 선택한 AI 모델, 모듈, 프롬프트 길이, 응답 길이에 따라 달라집니다. 가능한 경우 실행 전 예상 크레딧 사용량이 표시됩니다. 구독 크레딧이 먼저 소비되고, 이후 종량제 크레딧이 소비됩니다.' },
          { title: '4. 결제', body: '모든 결제는 PayPal 및 Polar를 포함한 결제 파트너를 통해 처리됩니다. 가격은 USD로 표시됩니다. AIMANI는 합리적인 공지와 함께 가격을 변경할 권리를 보유합니다.' },
          { title: '5. 환불', body: '자세한 내용은 환불정책을 참조하세요.' },
          { title: '6. AI 면책 조항', body: 'AIMANI는 정보 제공 및 엔터테인먼트 목적으로만 AI 생성 콘텐츠를 제공합니다. AI 답변은 법률, 의료, 재무, 세금 또는 심리 전문가의 조언을 구성하지 않습니다. AI 답변의 정확성, 완전성 또는 신뢰성을 보장하지 않습니다. AIMANI는 AI 생성 콘텐츠를 기반으로 내려진 결정에 대해 책임을 지지 않습니다.' },
          { title: '7. 서비스 가용성', body: 'AIMANI는 제3자 AI 프로바이더를 사용합니다. 귀하의 프롬프트 및 AI 답변은 응답 생성을 위해 제3자 AI 프로바이더(OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral)에 전송됩니다. 프로바이더 측 문제로 인한 특정 AI 모델의 중단, 오류 또는 서비스 종료에 대해 책임을 지지 않습니다. 이러한 중단에 대한 환불은 제공되지 않습니다.' },
          { title: '8. 금지 사항', body: '다음을 하지 않을 것에 동의합니다: 불법 목적으로 서비스 사용, 플랫폼 조작 또는 리버스 엔지니어링 시도, 무료 크레딧 남용을 위한 다중 계정 생성, 유해하거나 불법적인 콘텐츠 생성을 위한 서비스 사용.' },
          { title: '9. 계정 정지', body: 'AIMANI는 본 약관을 위반한 것으로 확인된 계정을 정지 또는 종료할 권리를 보유합니다(미사용 크레딧 몰수 포함).' },
          { title: '10. 약관 변경', body: '언제든지 본 약관을 업데이트할 수 있습니다. 서비스를 계속 이용하면 업데이트된 약관에 동의한 것으로 간주됩니다.' },
          { title: '11. 문의', body: 'support@aimani.ai' },
        ],
      },
      privacy: {
        lastUpdated: '최종 업데이트: 2026년 5월',
        title: '개인정보처리방침',
        sections: [
          { title: '1. 수집하는 정보', body: '계정 정보: 이메일 주소, 표시 이름. 이용 데이터: 사용한 모듈, 제출한 프롬프트, 수신한 AI 답변. 결제 데이터: PayPal을 통한 거래 기록(카드 정보는 저장하지 않음). 기술 데이터: IP 주소, 브라우저 유형, 기기 정보.' },
          { title: '2. 정보 이용 방법', body: '서비스 제공 및 개선을 위해. 결제 처리 및 크레딧 관리를 위해. 서비스 관련 이메일 발송을 위해. 이용 패턴 분석 및 AI 모듈 성능 개선을 위해. 플랫폼 보안 유지 및 남용 방지를 위해.' },
          { title: '3. 데이터 보관', body: '귀하의 데이터는 Supabase(PostgreSQL)를 통해 안전하게 보관됩니다. 귀하의 정보를 보호하기 위해 업계 표준 보안 조치를 구현하고 있습니다.' },
          { title: '4. 제3자 서비스', body: 'AIMANI는 다음 제3자 서비스를 사용합니다: Supabase(데이터베이스 및 인증), PayPal(결제 처리), Polar(결제 처리), OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral(AI 응답 생성——귀하의 프롬프트는 응답 생성을 위해 이러한 프로바이더에 전송됩니다), Vercel(호스팅), Resend(이메일). 각 프로바이더는 자체 개인정보처리방침에 따라 운영됩니다.' },
          { title: '5. 데이터 공유', body: '귀하의 개인 데이터를 판매하지 않습니다. 서비스 운영 또는 법적 의무 준수에 필요한 경우를 제외하고 제3자와 데이터를 공유하지 않습니다.' },
          { title: '6. 귀하의 권리', body: '귀하는 개인 데이터에 접근하고, 계정 및 데이터 삭제를 요청하며, 필수적이지 않은 커뮤니케이션을 거부할 권리가 있습니다. 문의: support@aimani.ai' },
          { title: '7. 쿠키', body: 'AIMANI는 인증 및 세션 관리를 위한 필수 쿠키를 사용합니다. 광고 쿠키는 사용하지 않습니다.' },
          { title: '8. 아동 개인정보', body: 'AIMANI는 14세 미만 아동을 대상으로 하지 않습니다. 부모의 동의 없이 14세 미만 아동으로부터 데이터를 의도적으로 수집하지 않습니다.' },
          { title: '9. 변경', body: '언제든지 본 개인정보처리방침을 업데이트할 수 있습니다. 중요한 변경사항은 이메일 또는 서비스 내 공지를 통해 사용자에게 알립니다.' },
          { title: '10. 문의', body: 'support@aimani.ai' },
        ],
      },
      refund: {
        lastUpdated: '최종 업데이트: 2026년 5월',
        title: '환불정책',
        sections: [
          { title: '1. 일반 정책', body: '크레딧의 모든 구매는 일단 사용된 후에는, 적용 가능한 법률에 의해 요구되는 경우 또는 결제 오류, 이중 청구, 구매한 크레딧 미지급의 경우를 제외하고, 최종적이며 환불되지 않습니다.' },
          { title: '2. 예외——신규 사용자', body: '신규 사용자로 크레딧을 사용하지 않은 경우, 첫 구매 후 24시간 이내에 support@aimani.ai에 연락하여 전액 환불을 요청할 수 있습니다. EU 또는 영국 사용자의 경우 디지털 콘텐츠 철회권이 적용될 수 있습니다. 구매를 완료하고 크레딧을 사용함으로써 디지털 콘텐츠 전달이 시작되었음을 인정하고, 적용 가능한 법률이 허용하는 범위에서 철회권을 포기하는 것에 동의합니다.' },
          { title: '3. 환불 불가 사례', body: '적용 가능한 법률에 의해 요구되는 경우를 제외하고, 다음은 환불 대상이 아닙니다: 일부 사용된 크레딧 패키지, 구독 크레딧(월별 리셋, 이월 없음), 이용약관 위반으로 인한 계정 정지로 손실된 크레딧, 제3자 AI 프로바이더 문제로 인한 서비스 중단.' },
          { title: '4. 결제 오류', body: '잘못 청구되었거나, 이중 청구가 발생했거나, 구매한 크레딧이 계정에 지급되지 않은 경우 즉시 support@aimani.ai로 연락해 주세요. 3영업일 이내에 조사하고 해결하겠습니다. 이러한 경우는 위의 일반 정책과 관계없이 환불 대상이 됩니다.' },
          { title: '5. 구독 취소', body: '구독을 취소하면 향후 청구가 중단됩니다. 취소 시 남은 크레딧은 현재 청구 기간이 끝날 때까지 사용 가능하며 환불되지 않습니다.' },
          { title: '6. 절차', body: '환불을 요청하려면 다음 내용과 함께 support@aimani.ai로 이메일을 보내주세요: 계정 이메일, 구매 날짜, 청구 금액, 요청 사유. 24시간 이내 답변을 목표로 합니다.' },
          { title: '7. 변경', body: 'AIMANI는 본 환불정책을 언제든지 업데이트할 권리를 보유합니다.' },
        ],
      },
    },
  },

  'zh-TW': {
    nav: {
      skip: '略過',
      previous: '上一頁',
      next: '下一頁',
      getStarted: '開始使用',
      backToSetup: '← 返回',
    },
    slide0: {
      chromeNote: '為獲得最佳中文體驗，建議使用 Chrome 的內建自動翻譯功能。',
      title: '我們有一個簡單的問題。',
      subtitle: '為什麼我們每次只問一個 AI？',
      body1: '每個 AI 的思考方式都不同。GPT 精確。Claude 深思熟慮。Gemini 快速。Grok 直率。DeepSeek 出人意料。Mistral 挑戰一切。我們建立 AIMANI，是因為相信真正的智慧不來自一個答案——而來自所有 AI 之間的摩擦。',
      body2: '研究一再證明，多元觀點勝過任何單一專家。AI 也是如此。',
      body3: '提問。比較。看他們爭論、協作、讓你驚喜。由你來判斷。',
      tagline: 'AIMANI — AI 與 AI 相遇之處。',
      headline: '一個問題。六個心智。零共識。',
      description: '大多數 AI 工具只給你結果。AIMANI 給你完整全貌——過程、摩擦、分歧、敘事，以及每個答案背後的集體智能。這就是差異所在。',
      credits: '🎁 您已獲得 30 點免費點數。無需信用卡。',
    },
    slide1: {
      title: '六個 AI。六個起源。六個觀點。',
      ais: [
        {
          heading: '🇺🇸 ChatGPT — OpenAI.',
          body: '將生成式 AI 帶入主流的 AI。全球使用最廣泛、最受認可的 AI 系統之一。背後是 OpenAI——將 AI 從研究課題轉化為全球消費革命的公司。',
        },
        {
          heading: '🇺🇸 Claude — Anthropic.',
          body: '由離開 OpenAI 的研究人員所創立的 Anthropic 開發，強烈聚焦於 AI 安全性、可靠性與謹慎推理。Anthropic 與 OpenAI 常被視為 AI 產業中最重要——且哲學上截然不同——的兩股力量。',
        },
        {
          heading: '🇺🇸 Gemini — Google DeepMind.',
          body: '由 Google DeepMind 支持，擁有驅動現代大型語言模型的 Transformer 架構研究遺產。Google 強勢回歸——Gemini 現已深度整合於 Google 生態系統，從 Android 到搜尋和生產力工具。',
        },
        {
          heading: '🇺🇸 Grok — xAI.',
          body: '由伊隆·馬斯克的 xAI 創建。馬斯克於 2015 年共同創立 OpenAI，後來最終分道揚鑣。自此，他與 OpenAI 的分歧成為 AI 世界最引人注目的對立之一。Grok 以比許多主流 AI 助手更直接、非傳統、反體制的風格著稱。',
        },
        {
          heading: '🇫🇷 Mistral — Mistral AI.',
          body: '法國巴黎。歐洲對美國 AI 主導地位最有力的回應之一。圍繞歐洲價值觀、歐洲法規和歐洲技術獨立性構建。不是矽谷。不是北京。是巴黎。',
        },
        {
          heading: '🇨🇳 DeepSeek — DeepSeek AI.',
          body: '中國杭州。由梁文鋒創立，根植於量化金融與對沖基金式工程思維。2025 年初 DeepSeek 的迅速崛起震驚了全球 AI 產業，並在美國科技市場引發重大反響。其出現加劇了圍繞 AI 效率、訓練方法以及日益激烈的中美 AI 競爭的辯論。',
        },
      ],
      closing: '同一個問題。六個模型。六種思考方式。總有新發現。',
      disclaimer: 'AIMANI 是連接多個 AI 模型供應商的獨立平台。我們與 OpenAI、Anthropic、Google、xAI、Mistral AI、DeepSeek 或任何其他供應商均無附屬、背書或官方合作關係。所有名稱及商標歸各自所有者所有。',
      lineup: '我們的 AI 陣容將持續擴展。根據效能、存取條件、政策和服務狀況，模型可能隨時更新、替換或移除。感謝您的理解。',
    },
    slide2: {
      title: '所有模組。一個平台。',
      modules: [
        'Compare — 同時向所有 6 個 AI 提出相同問題。您可以選擇包含哪些 AI——相同答案還是完全不同的答案，親自驗證。',
        'Persona — 為每個 AI 分配角色或性格。從不同觀點、立場和專業知識獲取答案。',
        'Panel — AI 進行評分、投票、排名、預測和事實查核。五種工具，一個結論。| Score: 查看評分和得分 | Vote: AI 投票表決，它們會選擇什麼？ | Rank: 6 個 AI 依序排名 | Predict: 機率與結果預測 | Fact Check: 真相 vs. 虛假',
        'Arena — 6 個 AI 就您的主題展開對決。邏輯論戰或街頭格鬥——純粹的 AI 對抗，兩種形式。',
        'Custom — 當您不需要複雜功能時。簡單快速地詢問一兩個 AI——幾乎像搜尋引擎一樣。或透過完整系統提示控制，為進階用戶提供深度使用。',
        'DEEP — 其他任何 AI 都無法比擬的深度與容量。從簡短摘要到完整報告。',
        'Oracle — 每日運勢、塔羅牌、星座占卜等。6 個 AI 各以不同方式解讀您的未來。無需出生時間。完整占卜體驗，無需高昂費用。',
        'Mindgame — AI 互相欺騙與背叛。你能相信誰？ | Carrier: 殭屍感染在 AI 之間蔓延。人類多於殭屍則獲勝。找出感染者，阻止擴散！ | Wolf: 誰是隱藏在 AI 中的狼？',
        'Stage — AI 創意表演。| Comedy Talk: AI 互嗆、脫口秀和單口喜劇 | TALE: AI 故事敘述——恐怖、浪漫、荒誕、科幻、童話、悲傷故事等 | Archive: AI 創意作品典藏庫',
      ],
    },
    slide3: {
      title: 'AIMANI 永不停止成長。',
      body: '新模組持續推出。創意無限、出人意料、全然不同的 AI 體驗——我們不斷探索。請加入書籤，常常回來看看。總有新事物在等著您。',
      closing: 'AI 們還有更多話要說。',
    },
    slide4: {
      title: '遇到問題了嗎？我們在這裡。',
      body1: '我們認真對待每一則訊息。如果有什麼出了問題，請告訴我們。如果您認為被錯誤收費，請聯繫我們。我們將迅速審查，若確認收費有誤，將依據退款政策進行處理。',
      pwa: '📱 將 AIMANI 安裝為應用程式 (PWA)——無需應用商店。手機：點選分享 → 加入主畫面。桌機：點選瀏覽器網址列的安裝圖示。您專屬的 AIMANI 圖示，直接在您的螢幕上。請僅從官方網站 (aimani.ai) 安裝。',
      handdrawn: '✏️ AIMANI 應用程式圖示由創辦人親手繪製。',
      aiwarning: '⚠️ AI 回應為自動生成，可能包含不準確、過時的資訊或錯誤。AIMANI 不保證任何 AI 輸出的準確性。在採取行動前，請務必通過權威來源核實重要資訊。',
      response: '我們回覆迅速。緊急付款問題預計在數小時內回覆——但時區差異可能造成輕微延遲。AIMANI 是由美國以外的小型團隊獨立運營的平台。',
      legalPrefix: '使用 AIMANI，即表示您同意我們的',
      legalTerms: '服務條款',
      legalSep1: '／',
      legalPrivacy: '隱私政策',
      legalSep2: '／',
      legalRefund: '退款政策',
      legalSuffix: '。',
    },
    policies: {
      terms: {
        lastUpdated: '最後更新：2026年5月',
        title: '服務條款',
        sections: [
          { title: '1. 條款接受', body: '透過存取或使用 AIMANI，您同意受本服務條款約束。如不同意，請勿使用本服務。' },
          { title: '2. 使用資格', body: '您必須年滿 14 歲才能使用本服務。未滿 18 歲的用戶進行付費交易須獲得父母或監護人的同意。' },
          { title: '3. 點數系統', body: '點數是用於存取 AIMANI 模組的服務內貨幣。訂閱點數每月重置，不得結轉。即付即用點數自購買日起有效期為 3 個月，並可在該期間內結轉。點數不可轉讓給其他用戶或兌換現金。點數消耗量因所選 AI 模型、模組、提示長度和回應長度而異。可能時，執行前將顯示預估點數使用量。訂閱點數優先消耗，其次為即付即用點數。' },
          { title: '4. 付款', body: '所有付款均透過我們的支付合作夥伴處理，包括 PayPal 和 Polar。價格以美元顯示。AIMANI 保留在合理通知後隨時更改定價的權利。' },
          { title: '5. 退款', body: '請參閱我們的退款政策了解詳情。' },
          { title: '6. AI 免責聲明', body: 'AIMANI 僅提供用於資訊和娛樂目的的 AI 生成內容。AI 回應不構成法律、醫療、財務、稅務或心理專業建議。我們不保證任何 AI 回應的準確性、完整性或可靠性。AIMANI 對基於 AI 生成內容所做的決定不承擔責任。' },
          { title: '7. 服務可用性', body: 'AIMANI 使用第三方 AI 供應商。您的提示和 AI 回應將傳輸至第三方 AI 供應商（OpenAI、Anthropic、Google、xAI、DeepSeek、Mistral）以生成回應。我們不對因供應商端問題導致的特定 AI 模型中斷、錯誤或停用負責。此類中斷不予退款。' },
          { title: '8. 禁止使用', body: '您同意不得：將本服務用於非法目的、嘗試操控或對平台進行逆向工程、建立多個帳戶以濫用免費點數、使用本服務生成有害或非法內容。' },
          { title: '9. 帳戶暫停', body: 'AIMANI 保留暫停或終止被發現違反本條款的帳戶的權利，包括沒收未使用的點數。' },
          { title: '10. 條款變更', body: '我們可能隨時更新本條款。繼續使用本服務即視為接受更新後的條款。' },
          { title: '11. 聯絡', body: 'support@aimani.ai' },
        ],
      },
      privacy: {
        lastUpdated: '最後更新：2026年5月',
        title: '隱私政策',
        sections: [
          { title: '1. 我們收集的資訊', body: '帳戶資訊：電子郵件地址、顯示名稱。使用資料：使用的模組、提交的提示、收到的 AI 回應。付款資料：透過 PayPal 的交易記錄（我們不儲存信用卡詳細資訊）。技術資料：IP 地址、瀏覽器類型、設備資訊。' },
          { title: '2. 我們如何使用您的資訊', body: '提供和改善服務。處理付款和管理點數。發送服務相關電子郵件。分析使用模式並改善 AI 模組效能。維護平台安全並防止濫用。' },
          { title: '3. 資料儲存', body: '您的資料透過 Supabase（PostgreSQL）安全儲存。我們實施行業標準安全措施來保護您的資訊。' },
          { title: '4. 第三方服務', body: 'AIMANI 使用以下第三方服務：Supabase（資料庫和身份驗證）、PayPal（支付處理）、Polar（支付處理）、OpenAI、Anthropic、Google、xAI、DeepSeek、Mistral（AI 回應生成——您的提示將傳輸至這些供應商以生成回應）、Vercel（託管）、Resend（電子郵件）。每個供應商均依其自身隱私政策運營。' },
          { title: '5. 資料共享', body: '我們不出售您的個人資料。除運營本服務或遵守法律義務所需外，我們不與第三方共享您的資料。' },
          { title: '6. 您的權利', body: '您有權存取您的個人資料、要求刪除您的帳戶和資料，以及選擇退出非必要通訊。聯絡：support@aimani.ai' },
          { title: '7. Cookies', body: 'AIMANI 使用必要的 cookies 進行身份驗證和會話管理。不使用廣告 cookies。' },
          { title: '8. 兒童隱私', body: 'AIMANI 不適用於 14 歲以下兒童。我們不會在未獲得父母同意的情況下故意收集 14 歲以下兒童的資料。' },
          { title: '9. 變更', body: '我們可能隨時更新本隱私政策。我們將透過電子郵件或服務內通知告知用戶重大變更。' },
          { title: '10. 聯絡', body: 'support@aimani.ai' },
        ],
      },
      refund: {
        lastUpdated: '最後更新：2026年5月',
        title: '退款政策',
        sections: [
          { title: '1. 一般政策', body: '點數購買一經使用即為最終交易，不予退款，但適用法律要求的情況，或付款錯誤、重複收費或購買點數未到帳的情況除外。' },
          { title: '2. 例外——新用戶', body: '若您為新用戶且尚未使用任何點數，可在首次購買後 24 小時內聯繫 support@aimani.ai 申請全額退款。歐盟或英國用戶可能適用數位內容撤回權。完成購買並使用點數，即表示您確認數位內容交付已開始，並在適用法律允許的範圍內放棄撤回權。' },
          { title: '3. 不可退款情況', body: '除適用法律要求外，以下情況不符合退款資格：部分使用的點數包、訂閱點數（每月重置，不結轉）、因違反服務條款導致帳戶被暫停而損失的點數、第三方 AI 供應商問題導致的服務中斷。' },
          { title: '4. 付款錯誤', body: '若您被錯誤收費、發生重複收費，或購買的點數未到帳，請立即聯繫 support@aimani.ai。我們將在 3 個工作日內調查並解決。無論上述一般政策如何，這些情況均符合退款資格。' },
          { title: '5. 訂閱取消', body: '取消訂閱將停止未來的計費。取消時剩餘的點數可使用至當前計費期結束，不予退款。' },
          { title: '6. 流程', body: '申請退款，請發送電子郵件至 support@aimani.ai，並附上：帳戶電子郵件、購買日期、收費金額及申請原因。我們目標在 24 小時內回覆。' },
          { title: '7. 變更', body: 'AIMANI 保留隨時更新本退款政策的權利。' },
        ],
      },
    },
  },

  fr: {
    nav: {
      skip: 'Passer',
      previous: 'Précédent',
      next: 'Suivant',
      getStarted: 'Commencer',
      backToSetup: '← Retour',
    },
    slide0: {
      chromeNote: 'Pour une meilleure expérience en français, utilisez la traduction automatique intégrée de Chrome.',
      title: 'Nous avions une question simple.',
      subtitle: "Pourquoi ne parle-t-on qu'à un seul IA à la fois ?",
      body1: "Chaque IA pense différemment. GPT est précis. Claude est réfléchi. Gemini est rapide. Grok est direct. DeepSeek vous surprend. Mistral remet tout en question. Nous avons créé AIMANI parce que la vraie intelligence ne vient pas d'une seule réponse — elle vient de la friction entre toutes.",
      body2: "La recherche montre constamment que plusieurs perspectives surpassent n'importe quel expert isolé. Il en va de même pour l'IA.",
      body3: "Posez. Comparez. Regardez-les s'affronter, collaborer et vous surprendre. Décidez par vous-même.",
      tagline: "AIMANI — Là où l'IA rencontre l'IA.",
      headline: 'Une question. Six esprits. Zéro consensus.',
      description: "La plupart des outils IA vous donnent un résultat. AIMANI vous donne la vue d'ensemble — le processus, la friction, le désaccord, le récit et l'intelligence collective derrière chaque réponse. C'est ça, la différence.",
      credits: '🎁 Vous avez reçu 30 crédits gratuits pour commencer. Sans carte bancaire.',
    },
    slide1: {
      title: 'Six IA. Six origines. Six perspectives.',
      ais: [
        {
          heading: '🇺🇸 ChatGPT — OpenAI.',
          body: "L'IA qui a introduit l'IA générative dans le grand public. L'un des systèmes IA les plus utilisés et reconnus au monde. Derrière lui se trouve OpenAI, la société qui a transformé l'IA d'un sujet de recherche en une révolution mondiale de la consommation.",
        },
        {
          heading: '🇺🇸 Claude — Anthropic.',
          body: "Créé par des chercheurs qui ont quitté OpenAI pour fonder Anthropic, avec un fort accent sur la sécurité de l'IA, la fiabilité et le raisonnement prudent. Anthropic et OpenAI sont souvent considérés comme deux des forces les plus importantes — et philosophiquement différentes — de l'industrie de l'IA.",
        },
        {
          heading: '🇺🇸 Gemini — Google DeepMind.',
          body: "Soutenu par Google DeepMind, l'héritage de recherche derrière l'architecture Transformer qui alimente les grands modèles de langage modernes. Google est revenu agressivement — et Gemini est maintenant profondément intégré dans l'écosystème Google, d'Android à Search et aux outils de productivité.",
        },
        {
          heading: '🇺🇸 Grok — xAI.',
          body: "Créé par xAI d'Elon Musk. Musk a cofondé OpenAI en 2015 avant de finalement se séparer de l'organisation. Depuis, ses désaccords avec OpenAI sont devenus l'une des rivalités les plus visibles du monde de l'IA. Grok est connu pour un style plus direct, non conventionnel et anti-establishment par rapport à de nombreux assistants IA grand public.",
        },
        {
          heading: '🇫🇷 Mistral — Mistral AI.',
          body: "Paris, France. L'une des réponses les plus fortes de l'Europe à la domination américaine de l'IA. Construit autour des valeurs européennes, de la réglementation européenne et de l'indépendance technologique européenne. Pas la Silicon Valley. Pas Pékin. Paris.",
        },
        {
          heading: '🇨🇳 DeepSeek — DeepSeek AI.',
          body: "Hangzhou, Chine. Fondé par Liang Wenfeng, avec des racines liées à la finance quantitative et à l'ingénierie de type hedge fund. La montée en puissance rapide de DeepSeek début 2025 a choqué l'industrie mondiale de l'IA et a déclenché une réaction majeure sur les marchés technologiques américains. Son émergence a intensifié le débat sur l'efficacité de l'IA, les méthodes d'entraînement et la rivalité croissante sino-américaine en matière d'IA.",
        },
      ],
      closing: 'La même question. Six modèles. Six façons de penser. Toujours quelque chose à découvrir.',
      disclaimer: "AIMANI est une plateforme indépendante qui connecte plusieurs fournisseurs de modèles IA. Nous ne sommes affiliés, approuvés, ni officiellement partenaires d'OpenAI, Anthropic, Google, xAI, Mistral AI, DeepSeek ou d'un autre fournisseur. Tous les noms et marques appartiennent à leurs propriétaires respectifs.",
      lineup: "Notre sélection d'IA continuera de s'élargir. Les modèles, agents et leur disponibilité peuvent être mis à jour, remplacés ou supprimés selon les performances, les accès, les politiques et les conditions de service. Merci de votre compréhension.",
    },
    slide2: {
      title: 'Tous les modules. Une seule plateforme.',
      modules: [
        "Compare — Posez la même question à tous les 6 IA en même temps. Vous choisissez quels IA inclure — mêmes réponses ou complètement différentes, vérifiez par vous-même.",
        "Persona — Attribuez un rôle ou un personnage à chaque IA. Obtenez des réponses depuis différentes perspectives, points de vue et expertises professionnelles.",
        "Panel — Les IA notent, votent, classent, prédisent et vérifient les faits. Cinq outils, une conclusion. | Score: Voir les évaluations et scores | Vote: Les IA votent. Que vont-elles choisir ? | Rank: Les 6 IA classées dans l'ordre | Predict: Prédiction de probabilité et de résultats | Fact Check: Vérité vs. fiction",
        "Arena — 6 IA s'affrontent sur votre sujet. Combat logique ou affrontement brut — pure confrontation IA, deux façons.",
        "Custom — Quand vous n'avez pas besoin de complexité. Posez une question simple à un ou deux IA rapidement — presque comme un moteur de recherche. Ou allez en profondeur avec un contrôle complet des prompts système pour les utilisateurs avancés.",
        "DEEP — Profondeur et volume qu'aucun autre IA ne peut égaler. D'un bref résumé à un rapport complet.",
        "Oracle — Fortune quotidienne, tarot, astrologie et plus. 6 IA lisent chacune votre avenir différemment. Pas besoin d'heure de naissance. Une expérience complète de divination sans le prix.",
        "Mindgame — Les IA se trompent et se trahissent mutuellement. À qui pouvez-vous faire confiance ? | Carrier: Une infection zombie se propage parmi les IA. Plus d'humains que de zombies signifie la victoire. Trouvez les infectés et arrêtez la propagation ! | Wolf: Qui est le loup caché parmi les IA ?",
        "Stage — Performances créatives par IA. | Comedy Talk: Banter tiki-taka IA, talk-shows et stand-up | TALE: Narration IA — Horreur, Romance, Absurde, Sci-Fi, Conte de fées, Histoire triste et plus | Archive: Un coffre des œuvres créatives de l'IA",
      ],
    },
    slide3: {
      title: "AIMANI ne s'arrête jamais de grandir.",
      body: "De nouveaux modules arrivent sans cesse. Des façons créatives, inattendues et radicalement différentes de vivre l'IA — nous continuons d'en trouver. Mettez-le en favoris. Revenez. Il y a toujours quelque chose de nouveau qui attend.",
      closing: "Les IA ont encore beaucoup à dire.",
    },
    slide4: {
      title: "Quelque chose ne va pas ? Nous sommes là.",
      body1: "Nous prenons chaque message au sérieux. Si quelque chose est cassé, nous voulons le savoir. Si vous pensez avoir été facturé incorrectement, contactez-nous. Nous examinerons rapidement et, si une facturation incorrecte est confirmée, nous régulariserons conformément à notre politique de remboursement.",
      pwa: "📱 Installez AIMANI en tant qu'application (PWA) — sans app store. Sur mobile : appuyez sur Partager → Ajouter à l'écran d'accueil. Sur ordinateur : cliquez sur l'icône d'installation dans la barre d'adresse de votre navigateur. Votre propre icône AIMANI, directement sur votre écran. N'installez qu'à partir du site officiel (aimani.ai).",
      handdrawn: "✏️ L'icône de l'application AIMANI a été dessinée à la main par le créateur.",
      aiwarning: "⚠️ Les réponses IA sont générées automatiquement et peuvent contenir des inexactitudes, des informations obsolètes ou des erreurs. AIMANI ne garantit pas l'exactitude des sorties IA. Vérifiez toujours les informations critiques auprès de sources officielles avant d'agir.",
      response: "Nous répondons rapidement. Pour les problèmes de paiement urgents, prévoyez une réponse dans les quelques heures — bien que les fuseaux horaires puissent causer de légers retards. AIMANI est une plateforme gérée indépendamment par une petite équipe en dehors des États-Unis.",
      legalPrefix: "En utilisant AIMANI, vous acceptez nos ",
      legalTerms: "Conditions d'utilisation",
      legalSep1: " / ",
      legalPrivacy: "Politique de confidentialité",
      legalSep2: " / ",
      legalRefund: "Politique de remboursement",
      legalSuffix: "",
    },
    policies: {
      terms: {
        lastUpdated: 'Dernière mise à jour : mai 2026',
        title: "Conditions d'utilisation",
        sections: [
          { title: "1. Acceptation des conditions", body: "En accédant ou en utilisant AIMANI, vous acceptez d'être lié par ces Conditions d'utilisation. Si vous n'acceptez pas, n'utilisez pas le Service." },
          { title: "2. Éligibilité", body: "Vous devez avoir au moins 14 ans pour utiliser le Service. Les utilisateurs de moins de 18 ans nécessitent le consentement parental ou d'un tuteur légal pour les transactions payantes." },
          { title: "3. Système de crédits", body: "Les crédits sont la monnaie interne utilisée pour accéder aux modules AIMANI. Les crédits d'abonnement se réinitialisent chaque mois sans report. Les crédits à la consommation sont valables 3 mois à compter de la date d'achat et se reportent dans cette période. Les crédits ne peuvent pas être transférés à d'autres utilisateurs ou échangés contre de l'argent. La consommation de crédits varie selon le modèle IA sélectionné, le module, la longueur du prompt et la longueur de la réponse. L'utilisation estimée de crédits sera affichée avant exécution lorsque possible. Les crédits d'abonnement sont consommés en premier, suivis des crédits à la consommation." },
          { title: "4. Paiements", body: "Tous les paiements sont traités via nos partenaires de paiement, dont PayPal et Polar. Les prix sont affichés en USD. AIMANI se réserve le droit de modifier les tarifs à tout moment avec un préavis raisonnable." },
          { title: "5. Remboursements", body: "Veuillez consulter notre Politique de remboursement pour tous les détails." },
          { title: "6. Clause de non-responsabilité IA", body: "AIMANI fournit du contenu généré par IA à des fins d'information et de divertissement uniquement. Les réponses IA ne constituent pas des conseils juridiques, médicaux, financiers, fiscaux ou psychologiques professionnels. Nous ne garantissons pas l'exactitude, l'exhaustivité ou la fiabilité des réponses IA. AIMANI n'est pas responsable des décisions prises sur la base du contenu généré par IA." },
          { title: "7. Disponibilité du service", body: "AIMANI utilise des fournisseurs IA tiers. Vos prompts et réponses IA sont transmis aux fournisseurs IA tiers (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral) pour générer des réponses. Nous ne sommes pas responsables des interruptions, erreurs ou arrêts de modèles IA spécifiques dus à des problèmes côté fournisseur. Aucun remboursement ne sera accordé pour de telles interruptions." },
          { title: "8. Utilisation interdite", body: "Vous acceptez de ne pas : utiliser le Service à des fins illégales, tenter de manipuler ou d'inverser la conception de la plateforme, créer plusieurs comptes pour abuser des crédits gratuits, utiliser le Service pour générer du contenu nuisible ou illégal." },
          { title: "9. Suspension de compte", body: "AIMANI se réserve le droit de suspendre ou de résilier les comptes trouvés en violation de ces Conditions, y compris la confiscation des crédits non utilisés." },
          { title: "10. Modifications des conditions", body: "Nous pouvons mettre à jour ces Conditions à tout moment. L'utilisation continue du Service constitue une acceptation des Conditions mises à jour." },
          { title: "11. Contact", body: "support@aimani.ai" },
        ],
      },
      privacy: {
        lastUpdated: 'Dernière mise à jour : mai 2026',
        title: "Politique de confidentialité",
        sections: [
          { title: "1. Informations que nous collectons", body: "Informations de compte : adresse e-mail, nom d'affichage. Données d'utilisation : modules utilisés, prompts soumis, réponses IA reçues. Données de paiement : enregistrements de transactions via PayPal (nous ne stockons pas les détails de carte). Données techniques : adresse IP, type de navigateur, informations sur l'appareil." },
          { title: "2. Comment nous utilisons vos informations", body: "Pour fournir et améliorer le Service. Pour traiter les paiements et gérer les crédits. Pour envoyer des e-mails liés au service. Pour analyser les schémas d'utilisation et améliorer les performances des modules IA. Pour maintenir la sécurité de la plateforme et prévenir les abus." },
          { title: "3. Stockage des données", body: "Vos données sont stockées de manière sécurisée via Supabase (PostgreSQL). Nous mettons en œuvre des mesures de sécurité conformes aux normes industrielles pour protéger vos informations." },
          { title: "4. Services tiers", body: "AIMANI utilise les services tiers suivants : Supabase (base de données et authentification), PayPal (traitement des paiements), Polar (traitement des paiements), OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral (génération de réponses IA — vos prompts sont transmis à ces fournisseurs pour générer des réponses), Vercel (hébergement), Resend (e-mail). Chaque fournisseur opère selon sa propre politique de confidentialité." },
          { title: "5. Partage des données", body: "Nous ne vendons pas vos données personnelles. Nous ne partageons pas vos données avec des tiers sauf si nécessaire pour exploiter le Service ou se conformer aux obligations légales." },
          { title: "6. Vos droits", body: "Vous avez le droit d'accéder à vos données personnelles, de demander la suppression de votre compte et de vos données, et de vous désabonner des communications non essentielles. Contact : support@aimani.ai" },
          { title: "7. Cookies", body: "AIMANI utilise des cookies essentiels pour l'authentification et la gestion de session. Aucun cookie publicitaire n'est utilisé." },
          { title: "8. Confidentialité des enfants", body: "AIMANI n'est pas destiné aux enfants de moins de 14 ans. Nous ne collectons pas sciemment des données d'enfants de moins de 14 ans sans consentement parental." },
          { title: "9. Modifications", body: "Nous pouvons mettre à jour cette Politique de confidentialité à tout moment. Nous informerons les utilisateurs des changements importants par e-mail ou notification dans le service." },
          { title: "10. Contact", body: "support@aimani.ai" },
        ],
      },
      refund: {
        lastUpdated: 'Dernière mise à jour : mai 2026',
        title: "Politique de remboursement",
        sections: [
          { title: "1. Politique générale", body: "Tous les achats de crédits sont définitifs et non remboursables une fois les crédits utilisés, sauf si requis par la loi applicable ou en cas d'erreur de paiement, de double facturation ou de non-livraison des crédits achetés." },
          { title: "2. Exception — Nouveaux utilisateurs", body: "Si vous êtes un nouvel utilisateur et n'avez pas utilisé de crédits, vous pouvez demander un remboursement complet dans les 24 heures suivant votre premier achat en contactant support@aimani.ai. Pour les utilisateurs de l'UE ou du Royaume-Uni, des droits de rétractation sur le contenu numérique peuvent s'appliquer. En complétant un achat et en utilisant des crédits, vous reconnaissez que la livraison du contenu numérique a commencé et renoncez à votre droit de rétractation dans la mesure permise par la loi applicable." },
          { title: "3. Cas non remboursables", body: "Sauf si requis par la loi applicable, les cas suivants ne sont pas éligibles aux remboursements : packages de crédits partiellement utilisés, crédits d'abonnement (réinitialisation mensuelle, sans report), crédits perdus suite à une suspension de compte pour violation des Conditions d'utilisation, interruptions de service causées par des problèmes du fournisseur IA tiers." },
          { title: "4. Erreurs de paiement", body: "Si vous avez été facturé incorrectement, avez subi une double facturation, ou si les crédits achetés n'ont pas été livrés sur votre compte, contactez-nous immédiatement à support@aimani.ai. Nous enquêterons et résoudrons dans les 3 jours ouvrables. Ces cas sont éligibles au remboursement indépendamment de la politique générale ci-dessus." },
          { title: "5. Annulation d'abonnement", body: "L'annulation d'un abonnement arrête la facturation future. Les crédits restants à l'annulation sont disponibles jusqu'à la fin de la période de facturation en cours et ne seront pas remboursés." },
          { title: "6. Procédure", body: "Pour demander un remboursement, envoyez un e-mail à support@aimani.ai avec : votre e-mail de compte, la date d'achat, le montant facturé et la raison de la demande. Nous visons à répondre dans les 24 heures." },
          { title: "7. Modifications", body: "AIMANI se réserve le droit de mettre à jour cette Politique de remboursement à tout moment." },
        ],
      },
    },
  },

  ar: {
    nav: {
      skip: 'تخطي',
      previous: 'السابق',
      next: 'التالي',
      getStarted: 'ابدأ الآن',
      backToSetup: 'رجوع →',
    },
    slide0: {
      chromeNote: 'للحصول على أفضل تجربة باللغة العربية، استخدم ميزة الترجمة التلقائية المدمجة في Chrome.',
      title: 'كان لدينا سؤال بسيط.',
      subtitle: 'لماذا نتحدث إلى ذكاء اصطناعي واحد فقط في كل مرة؟',
      body1: 'كل ذكاء اصطناعي يفكر بشكل مختلف. GPT دقيق. Claude متأمل. Gemini سريع. Grok صريح. DeepSeek يفاجئك. Mistral يتحدى الجميع. بنينا AIMANI لأن الذكاء الحقيقي لا يأتي من إجابة واحدة — بل يأتي من الاحتكاك بين جميعهم.',
      body2: 'تُثبت الأبحاث باستمرار أن وجهات النظر المتعددة تتفوق على أي خبير منفرد. وينطبق الأمر ذاته على الذكاء الاصطناعي.',
      body3: 'اسأل. قارن. شاهدهم يتجادلون ويتعاونون ويدهشونك. أنت من يقرر.',
      tagline: 'AIMANI — حيث يلتقي الذكاء الاصطناعي بالذكاء الاصطناعي.',
      headline: 'سؤال واحد. ستة عقول. لا توافق.',
      description: 'معظم أدوات الذكاء الاصطناعي تعطيك نتيجة. AIMANI يعطيك الصورة الكاملة — العملية، والاحتكاك، والخلاف، والسرد، والذكاء الجماعي وراء كل إجابة. هذا هو الفرق.',
      credits: '🎁 لقد حصلت على 30 رصيداً مجانياً للبدء. لا حاجة لبطاقة.',
    },
    slide1: {
      title: 'ستة ذكاءات اصطناعية. ستة أصول. ست وجهات نظر.',
      ais: [
        {
          heading: '🇺🇸 ChatGPT — OpenAI.',
          body: 'الذكاء الاصطناعي الذي أدخل الذكاء الاصطناعي التوليدي إلى التيار العام. أحد أكثر أنظمة الذكاء الاصطناعي استخداماً وتقديراً في العالم. خلفه OpenAI — الشركة التي حولت الذكاء الاصطناعي من موضوع بحثي إلى ثورة استهلاكية عالمية.',
        },
        {
          heading: '🇺🇸 Claude — Anthropic.',
          body: 'طوّرته Anthropic التي أسسها باحثون غادروا OpenAI، مع تركيز قوي على سلامة الذكاء الاصطناعي والموثوقية والتفكير الدقيق. كثيراً ما يُنظر إلى Anthropic وOpenAI باعتبارهما أهم قوتين — وأكثرهما اختلافاً فلسفياً — في صناعة الذكاء الاصطناعي.',
        },
        {
          heading: '🇺🇸 Gemini — Google DeepMind.',
          body: 'مدعوم من Google DeepMind، الإرث البحثي وراء بنية Transformer التي تشغّل نماذج اللغة الكبيرة الحديثة. عاد Google بقوة — وبات Gemini الآن متكاملاً بعمق في منظومة Google، من Android إلى البحث وأدوات الإنتاجية.',
        },
        {
          heading: '🇺🇸 Grok — xAI.',
          body: 'أنشأه xAI لإيلون ماسك. شارك ماسك في تأسيس OpenAI عام 2015 قبل أن ينفصل عنها في نهاية المطاف. منذ ذلك الحين، أصبحت خلافاته مع OpenAI من أبرز حالات التنافس في عالم الذكاء الاصطناعي. يُعرف Grok بأسلوب أكثر مباشرة وغير تقليدية ومعارضة للمألوف مقارنة بكثير من مساعدي الذكاء الاصطناعي السائدين.',
        },
        {
          heading: '🇫🇷 Mistral — Mistral AI.',
          body: 'باريس، فرنسا. واحدة من أقوى ردود أوروبا على الهيمنة الأمريكية في الذكاء الاصطناعي. مبني حول القيم الأوروبية، والتنظيم الأوروبي، والاستقلالية التكنولوجية الأوروبية. ليس وادي السيليكون. وليس بكين. باريس.',
        },
        {
          heading: '🇨🇳 DeepSeek — DeepSeek AI.',
          body: 'هانغتشو، الصين. أسسه ليانغ وينفينغ، بجذور مرتبطة بالتمويل الكمي والهندسة بأسلوب صناديق التحوط. أثار الصعود السريع لـ DeepSeek في مطلع عام 2025 صدمة في صناعة الذكاء الاصطناعي العالمية وأثار ردود فعل واسعة في أسواق التكنولوجيا الأمريكية. جاء ظهوره ليُعمّق النقاش حول كفاءة الذكاء الاصطناعي وأساليب التدريب والتنافس المتصاعد بين الولايات المتحدة والصين في هذا المجال.',
        },
      ],
      closing: 'نفس السؤال. ستة نماذج. ست طرق تفكير. دائماً ثمة شيء جديد لاكتشافه.',
      disclaimer: 'AIMANI منصة مستقلة تربط بين مزودي نماذج الذكاء الاصطناعي المتعددين. لسنا تابعين أو معتمدين أو شركاء رسميين لـ OpenAI أو Anthropic أو Google أو xAI أو Mistral AI أو DeepSeek أو أي مزود آخر. جميع الأسماء والعلامات التجارية ملك لأصحابها.',
      lineup: 'سيستمر نمو مجموعة الذكاء الاصطناعي لدينا. قد يتم تحديث النماذج والوكلاء وتوافرها أو استبدالها أو إزالتها بمرور الوقت وفقاً للأداء وشروط الوصول والسياسات وظروف الخدمة. شكراً لتفهمكم.',
    },
    slide2: {
      title: 'كل الوحدات. منصة واحدة.',
      modules: [
        'Compare — اطرح نفس السؤال على جميع الذكاءات الاصطناعية الستة في آنٍ واحد. يمكنك اختيار الذكاءات التي تريد تضمينها — نفس الإجابات أو مختلفة تماماً، تحقق بنفسك.',
        'Persona — امنح كل ذكاء اصطناعي دوراً أو شخصية. احصل على إجابات من وجهات نظر ومواقف وخبرات مهنية مختلفة.',
        'Panel — تُقيّم الذكاءات الاصطناعية وتصوّت وترتّب وتتنبأ وتتحقق من الحقائق. خمسة أدوات، نتيجة واحدة. | Score: شاهد التقييمات والنقاط | Vote: الذكاءات الاصطناعية تصوّت. ماذا ستختار؟ | Rank: الذكاءات الستة مرتبة بالتسلسل | Predict: توقع الاحتمالات والنتائج | Fact Check: الحقيقة مقابل الخيال',
        'Arena — 6 ذكاءات اصطناعية تتنافس حول موضوعك. منطق أو مواجهة — مقاتلة ذكاء اصطناعي خالصة، بطريقتين.',
        'Custom — حين لا تحتاج إلى تعقيد. اسأل ذكاءً اصطناعياً أو اثنين بسرعة وبساطة — تقريباً مثل محرك البحث. أو اذهب في العمق مع التحكم الكامل بنظام الأوامر للمستخدمين المتقدمين.',
        'DEEP — عمق وحجم لا يضاهيهما أي ذكاء اصطناعي آخر. من الملخص السريع إلى التقرير الكامل.',
        'Mindgame — تخدع الذكاءات الاصطناعية بعضها وتخون بعضها. من يمكنك الوثوق به؟ | Carrier: عدوى الزومبي تنتشر بين الذكاءات الاصطناعية. البشر أكثر من الزومبي يعني الفوز. اعثر على المصابين وأوقف الانتشار! | Wolf: من هو الذئب المختبئ بين الذكاءات الاصطناعية؟',
        'Stage — عروض إبداعية بالذكاء الاصطناعي. | Comedy Talk: ثرثرة تيكي-تاكا بالذكاء الاصطناعي، وبرامج حوارية، وستاند-أب | TALE: سرد قصصي بالذكاء الاصطناعي — رعب، رومانسي، عبثي، خيال علمي، حكاية خرافية، قصة حزينة والمزيد | Archive: خزينة أعمال الذكاء الاصطناعي الإبداعية',
      ],
    },
    slide3: {
      title: 'AIMANI لا يتوقف عن النمو أبداً.',
      body: 'وحدات جديدة تصل باستمرار. طرق إبداعية وغير متوقعة ومختلفة تماماً لتجربة الذكاء الاصطناعي — نواصل اكتشافها. ضع إشارة مرجعية. عُد مجدداً. دائماً ثمة جديد ينتظرك.',
      closing: 'لدى الذكاءات الاصطناعية المزيد لتقوله.',
    },
    slide4: {
      title: 'هل واجهت مشكلة؟ نحن هنا.',
      body1: 'نأخذ كل رسالة بجدية. إذا تعطّل شيء ما، أخبرنا. إذا كنت تعتقد أنك تعرضت لرسوم خاطئة، تواصل معنا. سنراجع الأمر فوراً، وإذا تأكدت صحة الرسوم الخاطئة، سنعالج المسألة وفقاً لسياسة الاسترداد.',
      pwa: '📱 قم بتثبيت AIMANI كتطبيق (PWA) — دون الحاجة لمتجر التطبيقات. على الجوال: اضغط مشاركة ← إضافة إلى الشاشة الرئيسية. على الكمبيوتر: انقر على أيقونة التثبيت في شريط العنوان. أيقونتك الخاصة لـ AIMANI مباشرةً على شاشتك. قم بالتثبيت من الموقع الرسمي فقط (aimani.ai).',
      handdrawn: '✏️ رسم أيقونة تطبيق AIMANI يدوياً من قبل المؤسس.',
      aiwarning: '⚠️ ردود الذكاء الاصطناعي تُولَّد تلقائياً وقد تحتوي على معلومات غير دقيقة أو قديمة أو أخطاء. لا يضمن AIMANI دقة أي مخرجات للذكاء الاصطناعي. تحقق دائماً من المعلومات الحساسة عبر مصادر موثوقة قبل اتخاذ أي إجراء.',
      response: 'نرد بسرعة. بالنسبة للمشكلات العاجلة في المدفوعات، توقع رداً في غضون ساعات قليلة — رغم أن فوارق التوقيت قد تسبب تأخيراً طفيفاً. AIMANI منصة مستقلة تديرها فريق صغير خارج الولايات المتحدة.',
      legalPrefix: 'باستخدامك AIMANI، أنت توافق على ',
      legalTerms: 'شروط الخدمة',
      legalSep1: ' / ',
      legalPrivacy: 'سياسة الخصوصية',
      legalSep2: ' / ',
      legalRefund: 'سياسة الاسترداد',
      legalSuffix: '.',
    },
    policies: {
      terms: {
        lastUpdated: 'آخر تحديث: مايو 2026',
        title: 'شروط الخدمة',
        sections: [
          { title: '1. قبول الشروط', body: 'من خلال الوصول إلى AIMANI أو استخدامه، فإنك توافق على الالتزام بشروط الخدمة هذه. إذا لم توافق، فلا تستخدم الخدمة.' },
          { title: '2. الأهلية', body: 'يجب أن يكون عمرك 14 عاماً على الأقل لاستخدام الخدمة. يحتاج المستخدمون دون سن 18 عاماً إلى موافقة الوالدين أو الوصي القانوني للمعاملات المدفوعة.' },
          { title: '3. نظام الأرصدة', body: 'الأرصدة هي العملة الداخلية المستخدمة للوصول إلى وحدات AIMANI. تُعاد تعيين أرصدة الاشتراك شهرياً دون ترحيل. أرصدة الدفع عند الاستخدام صالحة لمدة 3 أشهر من تاريخ الشراء ويمكن ترحيلها خلال تلك الفترة. لا يمكن نقل الأرصدة إلى مستخدمين آخرين أو استبدالها بنقود. يتفاوت استهلاك الأرصدة حسب نموذج الذكاء الاصطناعي المختار والوحدة وطول المطالبة وطول الاستجابة. سيتم عرض الاستخدام التقديري للأرصدة قبل التنفيذ عند الإمكان. تُستهلك أرصدة الاشتراك أولاً، تليها أرصدة الدفع عند الاستخدام.' },
          { title: '4. المدفوعات', body: 'تتم معالجة جميع المدفوعات عبر شركاء الدفع لدينا، بما في ذلك PayPal وPolar. تُعرض الأسعار بالدولار الأمريكي. يحتفظ AIMANI بالحق في تغيير الأسعار في أي وقت مع إشعار معقول.' },
          { title: '5. المبالغ المستردة', body: 'يرجى الرجوع إلى سياسة الاسترداد الخاصة بنا للاطلاع على التفاصيل الكاملة.' },
          { title: '6. إخلاء مسؤولية الذكاء الاصطناعي', body: 'يوفر AIMANI محتوى مُولَّداً بالذكاء الاصطناعي لأغراض المعلومات والترفيه فقط. لا تُشكّل ردود الذكاء الاصطناعي نصيحة قانونية أو طبية أو مالية أو ضريبية أو نفسية متخصصة. لا نضمن دقة أو اكتمال أو موثوقية أي رد من الذكاء الاصطناعي. لا يتحمل AIMANI المسؤولية عن القرارات المتخذة بناءً على المحتوى المُولَّد بالذكاء الاصطناعي.' },
          { title: '7. توفر الخدمة', body: 'يستخدم AIMANI مزودي ذكاء اصطناعي من طرف ثالث. يتم نقل مطالباتك وردود الذكاء الاصطناعي إلى مزودي الذكاء الاصطناعي من طرف ثالث (OpenAI، Anthropic، Google، xAI، DeepSeek، Mistral) لتوليد الردود. لسنا مسؤولين عن انقطاعات أو أخطاء أو إيقاف نماذج ذكاء اصطناعي محددة بسبب مشاكل على جانب المزود. لن يتم إصدار أي مبالغ مستردة لمثل هذه الانقطاعات.' },
          { title: '8. الاستخدام المحظور', body: 'توافق على عدم: استخدام الخدمة لأغراض غير قانونية، محاولة التلاعب بالمنصة أو إجراء هندسة عكسية، إنشاء حسابات متعددة للاستفادة من الأرصدة المجانية، استخدام الخدمة لتوليد محتوى ضار أو غير قانوني.' },
          { title: '9. تعليق الحساب', body: 'يحتفظ AIMANI بالحق في تعليق أو إنهاء الحسابات التي ثبت انتهاكها لهذه الشروط، بما في ذلك مصادرة الأرصدة غير المستخدمة.' },
          { title: '10. تغييرات الشروط', body: 'يجوز لنا تحديث هذه الشروط في أي وقت. الاستمرار في استخدام الخدمة يُعدّ قبولاً للشروط المحدّثة.' },
          { title: '11. التواصل', body: 'support@aimani.ai' },
        ],
      },
      privacy: {
        lastUpdated: 'آخر تحديث: مايو 2026',
        title: 'سياسة الخصوصية',
        sections: [
          { title: '1. المعلومات التي نجمعها', body: 'معلومات الحساب: عنوان البريد الإلكتروني، الاسم المعروض. بيانات الاستخدام: الوحدات المستخدمة، المطالبات المقدمة، ردود الذكاء الاصطناعي المستلمة. بيانات الدفع: سجلات المعاملات عبر PayPal (لا نخزن تفاصيل البطاقة). البيانات التقنية: عنوان IP، نوع المتصفح، معلومات الجهاز.' },
          { title: '2. كيف نستخدم معلوماتك', body: 'لتوفير الخدمة وتحسينها. لمعالجة المدفوعات وإدارة الأرصدة. لإرسال رسائل بريد إلكتروني متعلقة بالخدمة. لتحليل أنماط الاستخدام وتحسين أداء وحدات الذكاء الاصطناعي. للحفاظ على أمان المنصة ومنع الإساءة.' },
          { title: '3. تخزين البيانات', body: 'يتم تخزين بياناتك بأمان عبر Supabase (PostgreSQL). نطبّق تدابير أمنية وفق معايير الصناعة لحماية معلوماتك.' },
          { title: '4. خدمات الطرف الثالث', body: 'يستخدم AIMANI خدمات الطرف الثالث التالية: Supabase (قاعدة البيانات والمصادقة)، PayPal (معالجة المدفوعات)، Polar (معالجة المدفوعات)، OpenAI، Anthropic، Google، xAI، DeepSeek، Mistral (توليد ردود الذكاء الاصطناعي — يتم نقل مطالباتك إلى هؤلاء المزودين لتوليد الردود)، Vercel (الاستضافة)، Resend (البريد الإلكتروني). يعمل كل مزود وفق سياسة الخصوصية الخاصة به.' },
          { title: '5. مشاركة البيانات', body: 'لا نبيع بياناتك الشخصية. لا نشارك بياناتك مع أطراف ثالثة إلا عند الضرورة لتشغيل الخدمة أو الامتثال للالتزامات القانونية.' },
          { title: '6. حقوقك', body: 'يحق لك الوصول إلى بياناتك الشخصية، وطلب حذف حسابك وبياناتك، وإلغاء الاشتراك في الاتصالات غير الأساسية. للتواصل: support@aimani.ai' },
          { title: '7. ملفات تعريف الارتباط', body: 'يستخدم AIMANI ملفات تعريف الارتباط الأساسية للمصادقة وإدارة الجلسات. لا تُستخدم ملفات تعريف الارتباط الإعلانية.' },
          { title: '8. خصوصية الأطفال', body: 'AIMANI غير مخصص للأطفال دون سن 14 عاماً. لا نجمع عن قصد بيانات من أطفال دون 14 عاماً دون موافقة الوالدين.' },
          { title: '9. التغييرات', body: 'يجوز لنا تحديث سياسة الخصوصية هذه في أي وقت. سنُخطر المستخدمين بالتغييرات المهمة عبر البريد الإلكتروني أو إشعار داخل الخدمة.' },
          { title: '10. التواصل', body: 'support@aimani.ai' },
        ],
      },
      refund: {
        lastUpdated: 'آخر تحديث: مايو 2026',
        title: 'سياسة الاسترداد',
        sections: [
          { title: '1. السياسة العامة', body: 'جميع مشتريات الأرصدة نهائية وغير قابلة للاسترداد بمجرد استخدام الأرصدة، إلا إذا كان ذلك مطلوباً بموجب القانون المعمول به أو في حالات خطأ في الدفع أو ازدواجية الرسوم أو عدم تسليم الأرصدة المشتراة.' },
          { title: '2. استثناء — المستخدمون الجدد', body: 'إذا كنت مستخدماً جديداً ولم تستخدم أي أرصدة، يمكنك طلب استرداد كامل خلال 24 ساعة من أول عملية شراء بالتواصل مع support@aimani.ai. قد تسري حقوق سحب المحتوى الرقمي على مستخدمي الاتحاد الأوروبي أو المملكة المتحدة. من خلال إتمام عملية الشراء واستخدام الأرصدة، تقر بأن تسليم المحتوى الرقمي قد بدأ وتتنازل عن حق السحب بالقدر الذي يسمح به القانون المعمول به.' },
          { title: '3. حالات عدم الاسترداد', body: 'باستثناء ما يقتضيه القانون المعمول به، لا تكون الحالات التالية مؤهلة للاسترداد: حزم الأرصدة المستخدمة جزئياً، أرصدة الاشتراك (إعادة تعيين شهرية، بدون ترحيل)، الأرصدة المفقودة بسبب تعليق الحساب لانتهاك شروط الخدمة، انقطاعات الخدمة الناجمة عن مشاكل مزود الذكاء الاصطناعي من طرف ثالث.' },
          { title: '4. أخطاء الدفع', body: 'إذا تعرضت لرسوم خاطئة، أو ازدواجية في الرسوم، أو لم يتم تسليم الأرصدة المشتراة إلى حسابك، تواصل معنا فوراً على support@aimani.ai. سنحقق في الأمر ونحله في غضون 3 أيام عمل. هذه الحالات مؤهلة للاسترداد بصرف النظر عن السياسة العامة أعلاه.' },
          { title: '5. إلغاء الاشتراك', body: 'يؤدي إلغاء الاشتراك إلى إيقاف الفواتير المستقبلية. الأرصدة المتبقية عند الإلغاء متاحة حتى نهاية فترة الفوترة الحالية ولن يتم ردها.' },
          { title: '6. الإجراءات', body: 'لطلب الاسترداد، أرسل بريداً إلكترونياً إلى support@aimani.ai مع: بريدك الإلكتروني للحساب، تاريخ الشراء، المبلغ المحصّل، وسبب الطلب. نهدف إلى الرد خلال 24 ساعة.' },
          { title: '7. التغييرات', body: 'يحتفظ AIMANI بالحق في تحديث سياسة الاسترداد هذه في أي وقت.' },
        ],
      },
    },
  },

  es: {
    nav: {
      skip: 'Omitir',
      previous: 'Anterior',
      next: 'Siguiente',
      getStarted: 'Comenzar',
      backToSetup: '← Volver',
    },
    slide0: {
      chromeNote: 'Para una mejor experiencia en español, usa la función de traducción automática integrada de Chrome.',
      title: 'Teníamos una pregunta simple.',
      subtitle: '¿Por qué solo hablamos con una IA a la vez?',
      body1: 'Cada IA piensa diferente. GPT es preciso. Claude es reflexivo. Gemini es rápido. Grok es directo. DeepSeek te sorprende. Mistral lo desafía todo. Creamos AIMANI porque la verdadera inteligencia no viene de una sola respuesta — viene de la fricción entre todas ellas.',
      body2: 'La investigación demuestra constantemente que múltiples perspectivas superan a cualquier experto individual. Lo mismo ocurre con la IA.',
      body3: 'Pregunta. Compara. Obsérvalas pelear, colaborar y sorprenderte. Decide por ti mismo.',
      tagline: 'AIMANI — Donde la IA se encuentra con la IA.',
      headline: 'Una pregunta. Seis mentes. Cero consenso.',
      description: 'La mayoría de las herramientas de IA te dan un resultado. AIMANI te da el panorama completo — el proceso, la fricción, el desacuerdo, la narrativa y la inteligencia colectiva detrás de cada respuesta. Esa es la diferencia.',
      credits: '🎁 Has recibido 30 créditos gratis para empezar. Sin tarjeta.',
    },
    slide1: {
      title: 'Seis IAs. Seis orígenes. Seis perspectivas.',
      ais: [
        {
          heading: '🇺🇸 ChatGPT — OpenAI.',
          body: 'La IA que llevó la inteligencia artificial generativa al gran público. Uno de los sistemas de IA más utilizados y reconocidos del mundo. Detrás está OpenAI — la empresa que transformó la IA de un tema de investigación a una revolución global de consumo.',
        },
        {
          heading: '🇺🇸 Claude — Anthropic.',
          body: 'Creado por Anthropic, fundada por investigadores que dejaron OpenAI, con un fuerte enfoque en seguridad, fiabilidad y razonamiento cuidadoso de la IA. Anthropic y OpenAI se consideran frecuentemente las dos fuerzas más importantes — y filosóficamente diferentes — de la industria de la IA.',
        },
        {
          heading: '🇺🇸 Gemini — Google DeepMind.',
          body: 'Respaldado por Google DeepMind, el legado de investigación detrás de la arquitectura Transformer que impulsa los grandes modelos de lenguaje modernos. Google ha regresado con fuerza — y Gemini ahora está profundamente integrado en el ecosistema de Google, desde Android hasta Search y herramientas de productividad.',
        },
        {
          heading: '🇺🇸 Grok — xAI.',
          body: 'Creado por xAI de Elon Musk. Musk cofundó OpenAI en 2015 antes de separarse finalmente de la organización. Desde entonces, sus desacuerdos con OpenAI se han convertido en una de las rivalidades más visibles del mundo de la IA. Grok es conocido por un estilo más directo, no convencional y anti-establishment en comparación con muchos asistentes de IA convencionales.',
        },
        {
          heading: '🇫🇷 Mistral — Mistral AI.',
          body: 'París, Francia. Una de las respuestas más sólidas de Europa al dominio estadounidense de la IA. Construido alrededor de los valores europeos, la regulación europea y la independencia tecnológica europea. No es Silicon Valley. No es Pekín. Es París.',
        },
        {
          heading: '🇨🇳 DeepSeek — DeepSeek AI.',
          body: 'Hangzhou, China. Fundado por Liang Wenfeng, con raíces en las finanzas cuantitativas y la ingeniería al estilo de los fondos de cobertura. El rápido ascenso de DeepSeek a principios de 2025 sacudió la industria global de la IA y provocó una gran reacción en los mercados tecnológicos estadounidenses. Su aparición intensificó el debate sobre la eficiencia de la IA, los métodos de entrenamiento y la creciente rivalidad sino-estadounidense en este campo.',
        },
      ],
      closing: 'La misma pregunta. Seis modelos. Seis formas de pensar. Siempre algo nuevo que descubrir.',
      disclaimer: 'AIMANI es una plataforma independiente que conecta múltiples proveedores de modelos de IA. No estamos afiliados, respaldados ni somos socios oficiales de OpenAI, Anthropic, Google, xAI, Mistral AI, DeepSeek ni de ningún otro proveedor. Todos los nombres y marcas pertenecen a sus respectivos propietarios.',
      lineup: 'Nuestra selección de IA seguirá creciendo. Los modelos y su disponibilidad pueden actualizarse, reemplazarse o eliminarse según el rendimiento, el acceso, las políticas y las condiciones del servicio. Gracias por tu comprensión.',
    },
    slide2: {
      title: 'Todos los módulos. Una sola plataforma.',
      modules: [
        'Compare — Haz la misma pregunta a los 6 IAs a la vez. Puedes elegir qué IAs incluir — respuestas iguales o completamente diferentes, compruébalo tú mismo.',
        'Persona — Asigna un rol o personaje a cada IA. Obtén respuestas desde diferentes perspectivas, puntos de vista y conocimientos profesionales.',
        'Panel — Las IAs puntúan, votan, clasifican, predicen y verifican hechos. Cinco herramientas, una conclusión. | Score: Ve evaluaciones y puntuaciones | Vote: Las IAs votan. ¿Qué elegirán? | Rank: Los 6 IAs en orden | Predict: Predicción de probabilidad y resultados | Fact Check: Verdad vs. ficción',
        'Arena — 6 IAs compiten por tu tema. Batalla lógica o combate callejero — pura confrontación de IA, de dos maneras.',
        'Custom — Cuando no necesitas complejidad. Pregunta a uno o dos IAs de forma rápida y sencilla — casi como un motor de búsqueda. O profundiza con control total del prompt del sistema para usuarios avanzados.',
        'DEEP — Profundidad y volumen que ningún otro IA puede igualar. Desde un breve resumen hasta un informe completo.',
        'Oracle — Fortuna diaria, tarot, astrología y más. 6 IAs leen tu futuro cada uno a su manera. Sin necesidad de hora de nacimiento. Una experiencia de adivinación completa sin el precio.',
        'Mindgame — Las IAs se engañan y traicionan entre sí. ¿A quién puedes confiar? | Carrier: Una infección zombie se propaga entre las IAs. Más humanos que zombies significa victoria. ¡Encuentra a los infectados y detén la propagación! | Wolf: ¿Quién es el lobo oculto entre las IAs?',
        'Stage — Actuaciones creativas de IA. | Comedy Talk: Banter tiki-taka de IA, talk shows y stand-up | TALE: Narración de IA — Horror, Romance, Absurdo, Ciencia ficción, Cuento de hadas, Historia triste y más | Archive: Un cofre de obras creativas de IA',
      ],
    },
    slide3: {
      title: 'AIMANI nunca deja de crecer.',
      body: 'Nuevos módulos llegan constantemente. Formas creativas, inesperadas y radicalmente diferentes de experimentar la IA — seguimos encontrándolas. Márcalo como favorito. Vuelve. Siempre hay algo nuevo esperando.',
      closing: 'Las IAs aún tienen mucho que decir.',
    },
    slide4: {
      title: '¿Algo no va bien? Estamos aquí.',
      body1: 'Tomamos cada mensaje en serio. Si algo está roto, queremos saberlo. Si crees que te cobraron incorrectamente, contáctanos. Lo revisaremos rápidamente y, si se confirma un cobro incorrecto, lo gestionaremos según nuestra política de reembolso.',
      pwa: '📱 Instala AIMANI como aplicación (PWA) — sin tienda de apps. Móvil: toca Compartir → Añadir a pantalla de inicio. Escritorio: haz clic en el ícono de instalación en la barra de direcciones del navegador. Tu propio ícono de AIMANI directamente en tu pantalla. Solo instala desde el sitio oficial (aimani.ai).',
      handdrawn: '✏️ El ícono de la aplicación AIMANI fue dibujado a mano por el fundador.',
      aiwarning: '⚠️ Las respuestas de IA se generan automáticamente y pueden contener inexactitudes, información desactualizada o errores. AIMANI no garantiza la exactitud de ningún resultado de IA. Siempre verifica la información crítica con fuentes autorizadas antes de actuar.',
      response: 'Respondemos rápido. Para problemas urgentes de pago, espera respuesta en pocas horas — aunque las diferencias horarias pueden causar ligeros retrasos. AIMANI es una plataforma gestionada de forma independiente por un pequeño equipo fuera de los Estados Unidos.',
      legalPrefix: 'Al usar AIMANI, aceptas nuestros ',
      legalTerms: 'Términos de servicio',
      legalSep1: ' / ',
      legalPrivacy: 'Política de privacidad',
      legalSep2: ' / ',
      legalRefund: 'Política de reembolso',
      legalSuffix: '',
    },
    policies: {
      terms: {
        lastUpdated: 'Última actualización: mayo de 2026',
        title: 'Términos de servicio',
        sections: [
          { title: '1. Aceptación de los términos', body: 'Al acceder o utilizar AIMANI, aceptas estar sujeto a estos Términos de servicio. Si no estás de acuerdo, no uses el Servicio.' },
          { title: '2. Elegibilidad', body: 'Debes tener al menos 14 años para usar el Servicio. Los usuarios menores de 18 años requieren el consentimiento de los padres o tutores legales para transacciones de pago.' },
          { title: '3. Sistema de créditos', body: 'Los créditos son la moneda interna utilizada para acceder a los módulos de AIMANI. Los créditos de suscripción se reinician mensualmente sin acumulación. Los créditos de pago por uso son válidos por 3 meses desde la fecha de compra y se acumulan dentro de ese período. Los créditos no pueden transferirse a otros usuarios ni canjearse por dinero. El consumo de créditos varía según el modelo de IA seleccionado, el módulo, la longitud del prompt y la longitud de la respuesta. Los créditos de suscripción se consumen primero, seguidos de los créditos de pago por uso.' },
          { title: '4. Pagos', body: 'Todos los pagos se procesan a través de nuestros socios de pago, incluidos PayPal y Polar. Los precios se muestran en USD. AIMANI se reserva el derecho de cambiar los precios en cualquier momento con un aviso razonable.' },
          { title: '5. Reembolsos', body: 'Consulta nuestra Política de reembolso para todos los detalles.' },
          { title: '6. Descargo de responsabilidad de IA', body: 'AIMANI proporciona contenido generado por IA solo con fines informativos y de entretenimiento. Las respuestas de IA no constituyen asesoramiento legal, médico, financiero, fiscal o psicológico profesional. No garantizamos la exactitud, integridad o fiabilidad de ninguna respuesta de IA. AIMANI no es responsable de las decisiones tomadas en base al contenido generado por IA.' },
          { title: '7. Disponibilidad del servicio', body: 'AIMANI usa proveedores de IA de terceros. Tus prompts y respuestas de IA se transmiten a proveedores de IA de terceros (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral) para generar respuestas. No somos responsables de interrupciones, errores o cancelaciones de modelos de IA específicos debidos a problemas del proveedor. No se emitirán reembolsos por dichas interrupciones.' },
          { title: '8. Uso prohibido', body: 'Aceptas no: usar el Servicio para fines ilegales, intentar manipular o aplicar ingeniería inversa a la plataforma, crear múltiples cuentas para abusar de los créditos gratuitos, usar el Servicio para generar contenido dañino o ilegal.' },
          { title: '9. Suspensión de cuenta', body: 'AIMANI se reserva el derecho de suspender o cancelar cuentas que se encuentren en violación de estos Términos, incluida la confiscación de créditos no utilizados.' },
          { title: '10. Cambios en los términos', body: 'Podemos actualizar estos Términos en cualquier momento. El uso continuado del Servicio constituye la aceptación de los Términos actualizados.' },
          { title: '11. Contacto', body: 'support@aimani.ai' },
        ],
      },
      privacy: {
        lastUpdated: 'Última actualización: mayo de 2026',
        title: 'Política de privacidad',
        sections: [
          { title: '1. Información que recopilamos', body: 'Información de cuenta: dirección de correo electrónico, nombre para mostrar. Datos de uso: módulos utilizados, prompts enviados, respuestas de IA recibidas. Datos de pago: registros de transacciones a través de PayPal (no almacenamos datos de tarjetas). Datos técnicos: dirección IP, tipo de navegador, información del dispositivo.' },
          { title: '2. Cómo usamos tu información', body: 'Para proporcionar y mejorar el Servicio. Para procesar pagos y gestionar créditos. Para enviar correos electrónicos relacionados con el servicio. Para analizar patrones de uso y mejorar el rendimiento de los módulos de IA. Para mantener la seguridad de la plataforma y prevenir abusos.' },
          { title: '3. Almacenamiento de datos', body: 'Tus datos se almacenan de forma segura a través de Supabase (PostgreSQL). Implementamos medidas de seguridad estándar de la industria para proteger tu información.' },
          { title: '4. Servicios de terceros', body: 'AIMANI utiliza los siguientes servicios de terceros: Supabase (base de datos y autenticación), PayPal (procesamiento de pagos), Polar (procesamiento de pagos), OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral (generación de respuestas de IA — tus prompts se transmiten a estos proveedores para generar respuestas), Vercel (alojamiento), Resend (correo electrónico). Cada proveedor opera bajo su propia política de privacidad.' },
          { title: '5. Compartir datos', body: 'No vendemos tus datos personales. No compartimos tus datos con terceros excepto cuando sea necesario para operar el Servicio o cumplir con obligaciones legales.' },
          { title: '6. Tus derechos', body: 'Tienes derecho a acceder a tus datos personales, solicitar la eliminación de tu cuenta y datos, y optar por no recibir comunicaciones no esenciales. Contacto: support@aimani.ai' },
          { title: '7. Cookies', body: 'AIMANI utiliza cookies esenciales para la autenticación y la gestión de sesiones. No se utilizan cookies publicitarias.' },
          { title: '8. Privacidad de menores', body: 'AIMANI no está dirigido a menores de 14 años. No recopilamos deliberadamente datos de menores de 14 años sin el consentimiento de los padres.' },
          { title: '9. Cambios', body: 'Podemos actualizar esta Política de privacidad en cualquier momento. Notificaremos a los usuarios sobre cambios importantes por correo electrónico o mediante notificación en el servicio.' },
          { title: '10. Contacto', body: 'support@aimani.ai' },
        ],
      },
      refund: {
        lastUpdated: 'Última actualización: mayo de 2026',
        title: 'Política de reembolso',
        sections: [
          { title: '1. Política general', body: 'Todas las compras de créditos son definitivas y no reembolsables una vez utilizados los créditos, excepto cuando lo exija la ley aplicable o en casos de error de pago, cobro duplicado o no entrega de los créditos comprados.' },
          { title: '2. Excepción — Nuevos usuarios', body: 'Si eres un nuevo usuario y no has utilizado ningún crédito, puedes solicitar un reembolso completo dentro de las 24 horas posteriores a tu primera compra contactando a support@aimani.ai. Los usuarios de la UE o el Reino Unido pueden tener derechos de desistimiento del contenido digital. Al completar una compra y usar créditos, reconoces que la entrega del contenido digital ha comenzado y renuncias a tu derecho de desistimiento en la medida permitida por la ley aplicable.' },
          { title: '3. Casos no reembolsables', body: 'Excepto cuando lo exija la ley aplicable, los siguientes casos no son elegibles para reembolso: paquetes de créditos parcialmente utilizados, créditos de suscripción (reinicio mensual, sin acumulación), créditos perdidos debido a la suspensión de cuenta por violación de los Términos de servicio, interrupciones del servicio causadas por problemas del proveedor de IA de terceros.' },
          { title: '4. Errores de pago', body: 'Si se te cobró incorrectamente, se produjo un cobro duplicado o los créditos comprados no se entregaron en tu cuenta, contáctanos inmediatamente en support@aimani.ai. Investigaremos y resolveremos en 3 días hábiles. Estos casos son elegibles para reembolso independientemente de la política general anterior.' },
          { title: '5. Cancelación de suscripción', body: 'Cancelar una suscripción detiene la facturación futura. Los créditos restantes al momento de la cancelación están disponibles hasta el final del período de facturación actual y no serán reembolsados.' },
          { title: '6. Proceso', body: 'Para solicitar un reembolso, envía un correo electrónico a support@aimani.ai con: tu correo electrónico de cuenta, fecha de compra, monto cobrado y motivo de la solicitud. Nuestro objetivo es responder en 24 horas.' },
          { title: '7. Cambios', body: 'AIMANI se reserva el derecho de actualizar esta Política de reembolso en cualquier momento.' },
        ],
      },
    },
  },
}
