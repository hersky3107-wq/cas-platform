/**
 * Fire-and-forget lesson recompute after a grade or void.
 * The import stays dynamic so unit tests and a missing table never fail grading.
 * Vitest short-circuits before the server module loads, so the suite does not
 * phrase notes or write league_lesson_notes.
 */
export function scheduleLessonRefresh(roundId: string): void {
  if (process.env.VITEST) return
  void import('./lesson-notes.server')
    .then((mod) => mod.refreshLessonNotesForRound(roundId))
    .catch((e: unknown) => {
      console.warn(`[lesson-notes] refresh skipped: ${e instanceof Error ? e.message : e}`)
    })
}
