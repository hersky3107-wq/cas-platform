/**
 * Compatibility shim. League open analyses now live in deep-open-engine.ts
 * with league-local prompts. AX/MOTIE open-brief is not imported.
 */
export { runLeagueOpenAnalyses } from './deep-open-engine'
export {
  isLeagueOpenReplacementSeat,
  LEAGUE_DEAD_OPEN_PROVIDER,
  LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
  LEAGUE_OPEN_REPLACEMENT_PROVIDER,
  remapOpenPlanExaone,
} from './deep-open-replacement-policy'
