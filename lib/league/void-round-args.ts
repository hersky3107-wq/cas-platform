export type VoidRoundArgs = {
  roundId: string
  reason: string
  apply: boolean
}

export function parseVoidRoundArgs(argv: string[]): VoidRoundArgs | { error: string } {
  let roundId = ''
  let reason = 'data_error'
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') apply = true
    else if (arg === '--dry-run') apply = false
    else if (arg === '--round') roundId = argv[++i] ?? ''
    else if (arg.startsWith('--round=')) roundId = arg.slice('--round='.length)
    else if (arg === '--reason') reason = argv[++i] ?? reason
    else if (arg.startsWith('--reason=')) reason = arg.slice('--reason='.length)
  }
  if (!roundId.trim()) return { error: 'missing --round <uuid>' }
  return { roundId: roundId.trim(), reason: reason.trim() || 'data_error', apply }
}
