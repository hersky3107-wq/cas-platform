export function parseMarkPrelaunchArgs(argv: string[]): { apply: boolean; cutoff: string } {
  const apply = argv.includes('--apply') && !argv.includes('--dry-run')
  const at = argv.indexOf('--cutoff')
  const raw = at >= 0 ? argv[at + 1] : undefined
  const cutoff = raw && !raw.startsWith('--') ? new Date(raw).toISOString() : new Date().toISOString()
  if (Number.isNaN(Date.parse(cutoff))) {
    throw new Error(`invalid --cutoff ${raw}`)
  }
  return { apply, cutoff }
}
