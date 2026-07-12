/**
 * Shared governance prompt directives that must stay verbatim across LITE /
 * diagnostic / deliberate surfaces. Kept in this leaf module (no imports) so
 * brief.ts and deep.ts can both reference them without a circular dependency.
 */

/**
 * Cross-domain analysis directive with spurious-correlation guard.
 * Identical text must appear in brief, diagnostic, and deliberate prompts.
 */
export const CROSS_DOMAIN_DIRECTIVE =
  '부문 간 연관 분석 지침(중요):\n제공된 여러 부문 데이터(에너지·환경·수산·복지·관광 등)를 개별적으로만 보지 말고, 부문 간 연관·동시 변동·특이 패턴이 관찰되면 지적하라. 단, 상관을 인과로 단정하지 말 것 — 관찰된 패턴은 \'가설\'로 제시하고, 실제 연관성은 추가 분석이 필요함을 명시하며, 예산·정책 우선순위 판단은 사람의 몫으로 남겨라. 억지 연결이나 근거 없는 상관은 만들지 말 것.'

/**
 * Case-citation discipline directive. Stops panelists/chair from fabricating
 * specific court case numbers (e.g. "2019두45678", "2021헌바256") — a hallucination
 * tell that differs across rounds for the same topic — while keeping legal
 * reasoning available at the level of principles, statutes, and established
 * doctrine. Injected alongside TAG_DISCIPLINE_DIRECTIVE / CROSS_DOMAIN_DIRECTIVE
 * into the same governance analysis / debate / diagnostic system prompts.
 */
export const CASE_CITATION_DISCIPLINE =
  '판례 인용 규율(중요):\n구체적 사건번호(예: "2019두45678", "2021헌바256" 등 형식)를 지어내지 마십시오. 기억에 없는 사건번호를 만들어내는 것은 금지됩니다. 법리는 사건번호 없이 원칙·법령 조항·확립된 doctrine 수준으로 논하십시오(예: 신뢰보호 원칙, 비례성 원칙, 헌법 제23조 재산권, 제주특별법 제16조). 특정 판례의 취지를 언급하는 것 자체는 가능하나, 확신할 수 없는 사건번호·연도·법원명은 붙이지 마십시오 — 번호 없이 "대법원은 환경규제와 재산권의 비례성을 요구해왔다"처럼 논지만 쓰십시오. 사건번호 인용이 논증에 꼭 필요하다고 판단되면 반드시 [판례 확인 필요] 태그를 붙이십시오.'
