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
