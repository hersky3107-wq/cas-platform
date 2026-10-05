/**
 * Rebuild league_lesson_notes from graded rounds.
 * Dry-run by default. --apply phrases notes and upserts.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/rebuild-lesson-notes.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/rebuild-lesson-notes.ts --apply
 */
import { rebuildLessonNotes } from '@/lib/league/extra/lesson-notes.server'

async function main() {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run')
  const { notes, applied } = await rebuildLessonNotes(apply)
  for (const note of notes) {
    console.log(
      `${applied ? 'APPLY' : 'dry-run'} ${note.scope} ${note.category} ${note.horizon} n=${note.n_rounds} replay=${note.stats.replay.hits}/${note.stats.replay.n} ensemble=${note.stats.aiOverall.hits}/${note.stats.aiOverall.n}`,
    )
  }
  if (!apply) console.log('No write. Pass --apply to phrase and upsert.')
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/rebuild-lesson-notes.ts')
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
