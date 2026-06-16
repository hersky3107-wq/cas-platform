export type CreditsLocale = 'en' | 'ko' | 'ja' | 'zh-TW' | 'fr' | 'ar' | 'es'

export interface CreditsContent {
  back: string
  billing: string
  title: string
  subtitle: string
  balance: { label: string; unit: string }
  messages: {
    subscriptionCancelled: string
    subscriptionSuccess: string
    topupCancelled: string
    topupSuccess: string
    cancelConfirm: string
    confirmingTopup: string
    loading: string
    couldNotCancel: string
    addedCredits: string // "{n} credits added."
  }
  monthly: {
    title: string
    subtitle: string
    currentPlanBadge: string // "Current plan ·"
    currentPlanBtn: string
    subscribeBtn: string
    cardBtn: string
    redirectingBtn: string
    paypalRedirectingBtn: string
    howItWorks: string
    howItWorksDetail: string
    koPaypalNotice: string | null // null = hide
  }
  tryIt: {
    badge: string
    title: string
    oneTime: string
    paypalBtn: string
    cardBtn: string
  }
  addCredits: {
    title: string
    creditsFor: string // "{n} credits for ${usd}"
    validity: string
    adjustLabel: string
    creditsUnit: string
    paypalBtn: string // "Pay ${usd} with PayPal"
    cardBtn: string
  }
  howCreditsWork: {
    title: string
    bullet1: string
    bullet2: string
    bullet3: string
  }
  cancel: {
    currentPlanLabel: string
    cancelBtn: string
    cancellingBtn: string
  }
  footer: {
    prefix: string
    terms: string
    sep: string
    privacy: string
    refund: string
    suffix: string
  }
}

export const creditsContent: Record<CreditsLocale, CreditsContent> = {
  en: {
    back: '← Back to lobby',
    billing: 'Billing',
    title: 'Credits',
    subtitle: 'Subscribe for monthly credits. Use credits across Compare, Arena, Oracle, and other modes.',
    balance: { label: 'Current balance', unit: 'credits' },
    messages: {
      subscriptionCancelled: 'Subscription cancelled.',
      subscriptionSuccess: 'Your monthly plan is active. Thank you!',
      topupCancelled: 'Top-up payment cancelled.',
      topupSuccess: 'Top-up complete. Credits have been added to your account.',
      cancelConfirm: 'Are you sure you want to cancel? Your credits will remain until end of billing cycle.',
      confirmingTopup: 'Confirming your top-up payment…',
      loading: 'Loading…',
      couldNotCancel: 'Could not cancel subscription.',
      addedCredits: 'credits added.',
    },
    monthly: {
      title: 'Monthly Plans',
      subtitle: 'Auto-renews each month. Unused credits expire at end of billing cycle.',
      currentPlanBadge: 'Current plan ·',
      currentPlanBtn: 'Current plan',
      subscribeBtn: 'Subscribe',
      cardBtn: 'Pay with Card (Polar)',
      redirectingBtn: 'Redirecting…',
      paypalRedirectingBtn: 'Redirecting to PayPal…',
      howItWorks: 'How monthly credits work:',
      howItWorksDetail: 'Credits reset every billing cycle. Unused credits do not roll over. Cancel anytime.',
      koPaypalNotice: null,
    },
    tryIt: {
      badge: 'TRY IT',
      title: 'Try It',
      oneTime: '$8 one-time',
      paypalBtn: 'Pay $8 with PayPal',
      cardBtn: 'Pay with Card (Polar)',
    },
    addCredits: {
      title: 'ADD CREDITS',
      creditsFor: 'credits for',
      validity: 'Valid for 90 days · one-time payment',
      adjustLabel: 'Adjust amount',
      creditsUnit: 'credits',
      paypalBtn: 'Pay with PayPal',
      cardBtn: 'Pay with Card (Polar)',
    },
    howCreditsWork: {
      title: 'How credits work',
      bullet1: 'Monthly plan credits are used first',
      bullet2: 'Monthly credits reset each billing cycle (no rollover)',
      bullet3: 'Instant top-up available when monthly credits run out',
    },
    cancel: {
      currentPlanLabel: 'Current plan:',
      cancelBtn: 'Cancel Subscription',
      cancellingBtn: 'Cancelling…',
    },
    footer: {
      prefix: 'By using AIMANI, you agree to our',
      terms: 'Terms of Service',
      sep: ' / ',
      privacy: 'Privacy Policy',
      refund: 'Refund Policy',
      suffix: '',
    },
  },

  ko: {
    back: '← 로비로 돌아가기',
    billing: '결제',
    title: '크레딧',
    subtitle: '월간 크레딧을 구독하세요. Compare, Arena, Oracle 등 모든 모드에서 사용 가능합니다.',
    balance: { label: '현재 잔액', unit: '크레딧' },
    messages: {
      subscriptionCancelled: '구독이 취소되었습니다.',
      subscriptionSuccess: '월간 플랜이 활성화되었습니다. 감사합니다!',
      topupCancelled: '충전 결제가 취소되었습니다.',
      topupSuccess: '충전 완료. 크레딧이 계정에 추가되었습니다.',
      cancelConfirm: '정말 취소하시겠습니까? 청구 주기가 끝날 때까지 크레딧은 유지됩니다.',
      confirmingTopup: '충전 결제 확인 중…',
      loading: '로딩 중…',
      couldNotCancel: '구독을 취소할 수 없습니다.',
      addedCredits: '크레딧이 추가되었습니다.',
    },
    monthly: {
      title: '월간 플랜',
      subtitle: '매월 자동 갱신됩니다. 미사용 크레딧은 청구 주기 종료 시 만료됩니다.',
      currentPlanBadge: '현재 플랜 ·',
      currentPlanBtn: '현재 플랜',
      subscribeBtn: '구독하기',
      cardBtn: '카드로 결제 (Polar)',
      redirectingBtn: '이동 중…',
      paypalRedirectingBtn: 'PayPal로 이동 중…',
      howItWorks: '월간 크레딧 사용 방법:',
      howItWorksDetail: '크레딧은 매 청구 주기에 초기화됩니다. 미사용 크레딧은 이월되지 않습니다. 언제든지 취소 가능합니다.',
      koPaypalNotice: '한국 PayPal 계정은 국내 정책상 자국 서비스 결제가 제한됩니다. 한국 카드는 Polar 결제를 이용해주세요. Contact: support@aimani.ai',
    },
    tryIt: {
      badge: '체험',
      title: '체험 플랜',
      oneTime: '$8 일회성',
      paypalBtn: 'PayPal로 $8 결제',
      cardBtn: '카드로 결제 (Polar)',
    },
    addCredits: {
      title: '크레딧 충전',
      creditsFor: '크레딧,',
      validity: '90일 유효 · 일회 결제',
      adjustLabel: '금액 조정',
      creditsUnit: '크레딧',
      paypalBtn: 'PayPal로 결제',
      cardBtn: '카드로 결제 (Polar)',
    },
    howCreditsWork: {
      title: '크레딧 사용 방법',
      bullet1: '월간 플랜 크레딧이 먼저 사용됩니다',
      bullet2: '월간 크레딧은 청구 주기마다 초기화됩니다 (이월 없음)',
      bullet3: '월간 크레딧 소진 시 즉시 충전 가능합니다',
    },
    cancel: {
      currentPlanLabel: '현재 플랜:',
      cancelBtn: '구독 취소',
      cancellingBtn: '취소 중…',
    },
    footer: {
      prefix: 'AIMANI를 이용함으로써',
      terms: '이용약관',
      sep: ' / ',
      privacy: '개인정보처리방침',
      refund: '환불정책',
      suffix: '에 동의하는 것으로 간주됩니다.',
    },
  },

  ja: {
    back: '← ロビーに戻る',
    billing: 'お支払い',
    title: 'クレジット',
    subtitle: '月間クレジットをサブスクリプションで。Compare、Arena、Oracleなど全モードで使用可能です。',
    balance: { label: '現在の残高', unit: 'クレジット' },
    messages: {
      subscriptionCancelled: 'サブスクリプションがキャンセルされました。',
      subscriptionSuccess: '月間プランが有効になりました。ありがとうございます！',
      topupCancelled: 'チャージ支払いがキャンセルされました。',
      topupSuccess: 'チャージ完了。クレジットがアカウントに追加されました。',
      cancelConfirm: '本当にキャンセルしますか？クレジットは請求サイクル終了まで有効です。',
      confirmingTopup: 'チャージ支払いを確認中…',
      loading: '読み込み中…',
      couldNotCancel: 'サブスクリプションをキャンセルできませんでした。',
      addedCredits: 'クレジットが追加されました。',
    },
    monthly: {
      title: '月間プラン',
      subtitle: '毎月自動更新。未使用クレジットは請求サイクル終了時に期限切れになります。',
      currentPlanBadge: '現在のプラン ·',
      currentPlanBtn: '現在のプラン',
      subscribeBtn: 'サブスクリプション',
      cardBtn: 'カードで支払う (Polar)',
      redirectingBtn: '移動中…',
      paypalRedirectingBtn: 'PayPalへ移動中…',
      howItWorks: '月間クレジットの仕組み：',
      howItWorksDetail: 'クレジットは毎請求サイクルにリセットされます。未使用分は繰り越されません。いつでもキャンセル可能です。',
      koPaypalNotice: null,
    },
    tryIt: {
      badge: 'お試し',
      title: 'お試しプラン',
      oneTime: '$8 一回限り',
      paypalBtn: 'PayPalで$8支払う',
      cardBtn: 'カードで支払う (Polar)',
    },
    addCredits: {
      title: 'クレジット追加',
      creditsFor: 'クレジット、',
      validity: '90日間有効 · 一回限りの支払い',
      adjustLabel: '金額を調整',
      creditsUnit: 'クレジット',
      paypalBtn: 'PayPalで支払う',
      cardBtn: 'カードで支払う (Polar)',
    },
    howCreditsWork: {
      title: 'クレジットの仕組み',
      bullet1: '月間プランのクレジットが優先して使用されます',
      bullet2: '月間クレジットは毎請求サイクルにリセットされます（繰り越しなし）',
      bullet3: '月間クレジット使い切り後、即座にチャージ可能です',
    },
    cancel: {
      currentPlanLabel: '現在のプラン：',
      cancelBtn: 'サブスクリプションをキャンセル',
      cancellingBtn: 'キャンセル中…',
    },
    footer: {
      prefix: 'AiMANIを使用することで、',
      terms: '利用規約',
      sep: ' / ',
      privacy: 'プライバシーポリシー',
      refund: '返金ポリシー',
      suffix: 'に同意したものとみなされます。',
    },
  },

  'zh-TW': {
    back: '← 返回大廳',
    billing: '付款',
    title: '點數',
    subtitle: '訂閱每月點數。可在 Compare、Arena、Oracle 等所有模式中使用。',
    balance: { label: '目前餘額', unit: '點數' },
    messages: {
      subscriptionCancelled: '訂閱已取消。',
      subscriptionSuccess: '您的月訂閱已啟用。感謝您！',
      topupCancelled: '儲值付款已取消。',
      topupSuccess: '儲值完成。點數已新增至您的帳戶。',
      cancelConfirm: '確定要取消嗎？您的點數將保留至計費週期結束。',
      confirmingTopup: '確認儲值付款中…',
      loading: '載入中…',
      couldNotCancel: '無法取消訂閱。',
      addedCredits: '點數已新增。',
    },
    monthly: {
      title: '月訂閱方案',
      subtitle: '每月自動續訂。未使用點數於計費週期結束時到期。',
      currentPlanBadge: '目前方案 ·',
      currentPlanBtn: '目前方案',
      subscribeBtn: '訂閱',
      cardBtn: '信用卡付款 (Polar)',
      redirectingBtn: '跳轉中…',
      paypalRedirectingBtn: '跳轉至 PayPal…',
      howItWorks: '月訂點數使用方式：',
      howItWorksDetail: '點數每計費週期重置。未使用點數不予累計。可隨時取消。',
      koPaypalNotice: null,
    },
    tryIt: {
      badge: '體驗',
      title: '體驗方案',
      oneTime: '$8 一次性付款',
      paypalBtn: '以 PayPal 支付 $8',
      cardBtn: '信用卡付款 (Polar)',
    },
    addCredits: {
      title: '儲值點數',
      creditsFor: '點數，',
      validity: '90天有效 · 一次性付款',
      adjustLabel: '調整金額',
      creditsUnit: '點數',
      paypalBtn: '以 PayPal 支付',
      cardBtn: '信用卡付款 (Polar)',
    },
    howCreditsWork: {
      title: '點數使用方式',
      bullet1: '月訂方案點數優先使用',
      bullet2: '月訂點數每計費週期重置（不累計）',
      bullet3: '月訂點數用完後可立即儲值',
    },
    cancel: {
      currentPlanLabel: '目前方案：',
      cancelBtn: '取消訂閱',
      cancellingBtn: '取消中…',
    },
    footer: {
      prefix: '使用 AIMANI，即表示您同意我們的',
      terms: '服務條款',
      sep: '／',
      privacy: '隱私政策',
      refund: '退款政策',
      suffix: '。',
    },
  },

  fr: {
    back: '← Retour au lobby',
    billing: 'Facturation',
    title: 'Crédits',
    subtitle: "Abonnez-vous pour des crédits mensuels. Utilisables sur Compare, Arena, Oracle et autres modes.",
    balance: { label: 'Solde actuel', unit: 'crédits' },
    messages: {
      subscriptionCancelled: 'Abonnement annulé.',
      subscriptionSuccess: 'Votre plan mensuel est actif. Merci !',
      topupCancelled: 'Paiement de recharge annulé.',
      topupSuccess: 'Recharge effectuée. Les crédits ont été ajoutés à votre compte.',
      cancelConfirm: "Voulez-vous vraiment annuler ? Vos crédits restent valables jusqu'à la fin du cycle de facturation.",
      confirmingTopup: 'Confirmation du paiement de recharge…',
      loading: 'Chargement…',
      couldNotCancel: "Impossible d'annuler l'abonnement.",
      addedCredits: 'crédits ajoutés.',
    },
    monthly: {
      title: 'Plans mensuels',
      subtitle: 'Renouvellement automatique chaque mois. Les crédits non utilisés expirent à la fin du cycle.',
      currentPlanBadge: 'Plan actuel ·',
      currentPlanBtn: 'Plan actuel',
      subscribeBtn: "S'abonner",
      cardBtn: 'Payer par carte (Polar)',
      redirectingBtn: 'Redirection…',
      paypalRedirectingBtn: 'Redirection vers PayPal…',
      howItWorks: 'Fonctionnement des crédits mensuels :',
      howItWorksDetail: "Les crédits se réinitialisent à chaque cycle. Les crédits non utilisés ne sont pas reportés. Annulable à tout moment.",
      koPaypalNotice: null,
    },
    tryIt: {
      badge: 'ESSAI',
      title: 'Essai',
      oneTime: '8 $ unique',
      paypalBtn: 'Payer 8 $ avec PayPal',
      cardBtn: 'Payer par carte (Polar)',
    },
    addCredits: {
      title: 'AJOUTER DES CRÉDITS',
      creditsFor: 'crédits pour',
      validity: 'Valable 90 jours · paiement unique',
      adjustLabel: 'Ajuster le montant',
      creditsUnit: 'crédits',
      paypalBtn: 'Payer avec PayPal',
      cardBtn: 'Payer par carte (Polar)',
    },
    howCreditsWork: {
      title: 'Fonctionnement des crédits',
      bullet1: 'Les crédits du plan mensuel sont utilisés en premier',
      bullet2: 'Les crédits mensuels se réinitialisent à chaque cycle (sans report)',
      bullet3: 'Recharge instantanée disponible quand les crédits mensuels sont épuisés',
    },
    cancel: {
      currentPlanLabel: 'Plan actuel :',
      cancelBtn: "Annuler l'abonnement",
      cancellingBtn: 'Annulation…',
    },
    footer: {
      prefix: "En utilisant AIMANI, vous acceptez nos",
      terms: "Conditions d'utilisation",
      sep: ' / ',
      privacy: 'Politique de confidentialité',
      refund: 'Politique de remboursement',
      suffix: '',
    },
  },

  ar: {
    back: 'رجوع إلى اللوبي →',
    billing: 'الفوترة',
    title: 'الأرصدة',
    subtitle: 'اشترك للحصول على أرصدة شهرية. يمكن استخدامها في Compare وArena وOracle وجميع الأوضاع.',
    balance: { label: 'الرصيد الحالي', unit: 'رصيد' },
    messages: {
      subscriptionCancelled: 'تم إلغاء الاشتراك.',
      subscriptionSuccess: 'خطتك الشهرية فعّالة. شكراً لك!',
      topupCancelled: 'تم إلغاء دفع الشحن.',
      topupSuccess: 'اكتمل الشحن. تمت إضافة الأرصدة إلى حسابك.',
      cancelConfirm: 'هل أنت متأكد من الإلغاء؟ ستبقى أرصدتك صالحة حتى نهاية دورة الفوترة.',
      confirmingTopup: 'جارٍ تأكيد دفع الشحن…',
      loading: 'جارٍ التحميل…',
      couldNotCancel: 'تعذّر إلغاء الاشتراك.',
      addedCredits: 'رصيد تمت إضافته.',
    },
    monthly: {
      title: 'الخطط الشهرية',
      subtitle: 'يتجدد تلقائياً كل شهر. تنتهي صلاحية الأرصدة غير المستخدمة في نهاية دورة الفوترة.',
      currentPlanBadge: 'الخطة الحالية ·',
      currentPlanBtn: 'الخطة الحالية',
      subscribeBtn: 'اشترك',
      cardBtn: 'الدفع بالبطاقة (Polar)',
      redirectingBtn: 'جارٍ التحويل…',
      paypalRedirectingBtn: 'جارٍ التحويل إلى PayPal…',
      howItWorks: 'كيفية عمل الأرصدة الشهرية:',
      howItWorksDetail: 'تُعاد تعيين الأرصدة في كل دورة فوترة. الأرصدة غير المستخدمة لا تُرحَّل. يمكن الإلغاء في أي وقت.',
      koPaypalNotice: null,
    },
    tryIt: {
      badge: 'تجربة',
      title: 'الباقة التجريبية',
      oneTime: '$8 دفعة واحدة',
      paypalBtn: 'الدفع $8 عبر PayPal',
      cardBtn: 'الدفع بالبطاقة (Polar)',
    },
    addCredits: {
      title: 'إضافة أرصدة',
      creditsFor: 'رصيد مقابل',
      validity: 'صالح 90 يوماً · دفعة واحدة',
      adjustLabel: 'تعديل المبلغ',
      creditsUnit: 'رصيد',
      paypalBtn: 'الدفع عبر PayPal',
      cardBtn: 'الدفع بالبطاقة (Polar)',
    },
    howCreditsWork: {
      title: 'كيفية عمل الأرصدة',
      bullet1: 'تُستخدم أرصدة الخطة الشهرية أولاً',
      bullet2: 'تُعاد تعيين الأرصدة الشهرية في كل دورة فوترة (بدون ترحيل)',
      bullet3: 'الشحن الفوري متاح عند نفاد الأرصدة الشهرية',
    },
    cancel: {
      currentPlanLabel: 'الخطة الحالية:',
      cancelBtn: 'إلغاء الاشتراك',
      cancellingBtn: 'جارٍ الإلغاء…',
    },
    footer: {
      prefix: 'باستخدام AIMANI، أنت توافق على',
      terms: 'شروط الخدمة',
      sep: ' / ',
      privacy: 'سياسة الخصوصية',
      refund: 'سياسة الاسترداد',
      suffix: '.',
    },
  },

  es: {
    back: '← Volver al lobby',
    billing: 'Facturación',
    title: 'Créditos',
    subtitle: 'Suscríbete para obtener créditos mensuales. Úsalos en Compare, Arena, Oracle y otros modos.',
    balance: { label: 'Saldo actual', unit: 'créditos' },
    messages: {
      subscriptionCancelled: 'Suscripción cancelada.',
      subscriptionSuccess: '¡Tu plan mensual está activo. Gracias!',
      topupCancelled: 'Pago de recarga cancelado.',
      topupSuccess: 'Recarga completada. Los créditos se han añadido a tu cuenta.',
      cancelConfirm: '¿Seguro que quieres cancelar? Tus créditos permanecerán hasta el final del ciclo de facturación.',
      confirmingTopup: 'Confirmando el pago de recarga…',
      loading: 'Cargando…',
      couldNotCancel: 'No se pudo cancelar la suscripción.',
      addedCredits: 'créditos añadidos.',
    },
    monthly: {
      title: 'Planes mensuales',
      subtitle: 'Se renueva automáticamente cada mes. Los créditos no utilizados expiran al final del ciclo.',
      currentPlanBadge: 'Plan actual ·',
      currentPlanBtn: 'Plan actual',
      subscribeBtn: 'Suscribirse',
      cardBtn: 'Pagar con tarjeta (Polar)',
      redirectingBtn: 'Redirigiendo…',
      paypalRedirectingBtn: 'Redirigiendo a PayPal…',
      howItWorks: 'Cómo funcionan los créditos mensuales:',
      howItWorksDetail: 'Los créditos se reinician en cada ciclo. Los créditos no usados no se acumulan. Cancela cuando quieras.',
      koPaypalNotice: null,
    },
    tryIt: {
      badge: 'PRUEBA',
      title: 'Prueba',
      oneTime: '$8 pago único',
      paypalBtn: 'Pagar $8 con PayPal',
      cardBtn: 'Pagar con tarjeta (Polar)',
    },
    addCredits: {
      title: 'AÑADIR CRÉDITOS',
      creditsFor: 'créditos por',
      validity: 'Válido 90 días · pago único',
      adjustLabel: 'Ajustar cantidad',
      creditsUnit: 'créditos',
      paypalBtn: 'Pagar con PayPal',
      cardBtn: 'Pagar con tarjeta (Polar)',
    },
    howCreditsWork: {
      title: 'Cómo funcionan los créditos',
      bullet1: 'Los créditos del plan mensual se usan primero',
      bullet2: 'Los créditos mensuales se reinician en cada ciclo (sin acumulación)',
      bullet3: 'Recarga instantánea disponible cuando se agoten los créditos mensuales',
    },
    cancel: {
      currentPlanLabel: 'Plan actual:',
      cancelBtn: 'Cancelar suscripción',
      cancellingBtn: 'Cancelando…',
    },
    footer: {
      prefix: 'Al usar AIMANI, aceptas nuestros',
      terms: 'Términos de servicio',
      sep: ' / ',
      privacy: 'Política de privacidad',
      refund: 'Política de reembolso',
      suffix: '',
    },
  },
}

export function detectCreditsLocale(): CreditsLocale {
  if (typeof navigator === 'undefined') return 'en'
  const lang = navigator.language.toLowerCase()
  if (lang.startsWith('ko')) return 'ko'
  if (lang.startsWith('ja')) return 'ja'
  if (lang.startsWith('zh-tw') || lang.startsWith('zh-hk') || lang.includes('hant')) return 'zh-TW'
  if (lang.startsWith('fr')) return 'fr'
  if (lang.startsWith('ar')) return 'ar'
  if (lang.startsWith('es')) return 'es'
  return 'en'
}
