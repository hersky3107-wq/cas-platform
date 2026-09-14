/**
 * Compatibility shim. League debate / vote now live in deep-debate-engine.ts
 * with league-local prompts. AX/MOTIE deep.ts is not imported.
 */
export { runLeagueDeliberation, runLeagueMotionVote } from './deep-debate-engine'
export {
  LEAGUE_VOTE_BRAND_LABEL,
  LEAGUE_VOTE_PANEL,
  remapOpenPlanExaone,
} from './deep-open-replacement-policy'
