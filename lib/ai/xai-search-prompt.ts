/**
 * xAI system-prompt length directive.
 *
 * Closed-book Grok seats (premier/challenger) still get the "use full
 * capacity" suffix. Scout live-search must not — that directive made
 * grok-4.6-livesearch chew the 24k web context for ~100s.
 */

export const XAI_NON_SEARCH_LENGTH_SUFFIX =
  '\n\nIMPORTANT: Write a thorough, detailed response. Do NOT cut your response short. Use your full available token capacity. A short response is a failure.'

export function xaiSystemLengthSuffix(opts: { searchTool?: boolean }): string {
  return opts.searchTool ? '' : XAI_NON_SEARCH_LENGTH_SUFFIX
}
