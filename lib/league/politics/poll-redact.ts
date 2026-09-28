/**
 * Korean election law: do not publish poll percentages that imply a winner.
 * Factual event sentences stay. Non-KR text is unchanged.
 */

const POLL_SENTENCE = /여론조사|지지율|찬성률|polling|poll\b|approval rating|survey result|조사 결과/i

export function redactPollFigures(text: string): string {
  const chunks = text.split(/(?<=[.!?。\n])\s*/)
  return chunks
    .map((chunk) => {
      if (!POLL_SENTENCE.test(chunk)) {
        return chunk.replace(/지지율\s*\d+(?:\.\d+)?\s*%/g, '지지율')
      }
      return chunk
        .replace(/\d+(?:\.\d+)?\s*%/g, '[omit]')
        .replace(/\d+(?:\.\d+)?\s*(?:points|포인트|percentage points)/gi, '[omit]')
        .replace(/지지율\s*\d+(?:\.\d+)?/g, '지지율')
    })
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function containsPollPercentage(text: string): boolean {
  return /지지율\s*\d|여론조사[^.\n]{0,80}\d+(?:\.\d+)?\s*%|polling[^.\n]{0,40}\d+(?:\.\d+)?\s*%/i.test(text)
}
