/**
 * Public track record starts at launch. Pre-launch rounds are `is_test`
 * and must not appear on any public list. Admin pages still see them.
 */

export function isTestRound(row: { is_test?: boolean | null }): boolean {
  return row.is_test === true
}

export function excludeTestRounds<T extends { is_test?: boolean | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isTestRound(row))
}

export function isMissingTestColumnError(message: string): boolean {
  return /is_test/i.test(message) && /does not exist|schema cache/i.test(message)
}
