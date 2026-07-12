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

/**
 * Bandwagon-resistance directive. Makes each panelist commit to an independent
 * judgment and surface the strongest counter-argument BEFORE conforming, so
 * consensus is reached by evidence rather than by drifting to a safe-looking
 * "조건부 찬성" to avoid standing out. Does NOT force disagreement, assign
 * positions, or add a vote option — genuine consensus (including unanimous)
 * stays fully legitimate. Injected alongside CASE_CITATION_DISCIPLINE /
 * CROSS_DOMAIN_DIRECTIVE into the same governance analysis / debate /
 * diagnostic system prompts.
 */
export const BANDWAGON_RESISTANCE =
  '편승 방지 — 독립 판단 우선(중요):\n다른 참여자의 최종 입장에 맞추기 위해 네 판단을 바꾸지 마라. 다수가 어느 쪽이든, 너의 근거가 다르면 다른 결론을 유지하라. 어떤 안건이든 결론을 내리기 전에, 그 안건에 존재하는 \'가장 강한 반대 또는 우려 논거\'를 먼저 한두 문장으로 명시하라. 그런 다음 그 논거를 감안한 너의 판단을 내려라. \'반대 논거를 진술하는 것\'과 \'반대에 투표하는 것\'은 별개다. 찬성하더라도 반대 논거는 반드시 기록에 남겨라. 우려가 결론을 뒤집을 만큼 크면 기권·반대도 정당한 선택이다. \'무난해 보이려고\' 조건부 찬성으로 물러서지 마라. 조건부는 실제로 조건이 결론을 가를 때만 선택하라. 전원이 같은 쪽으로 쏠리는 것이 옳을 때도 있으나, 그것은 눈치가 아니라 근거로 도달한 것이어야 한다.'
