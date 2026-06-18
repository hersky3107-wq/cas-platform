import 'server-only'

import { extractUrl } from '@/lib/extract/adapters/url'
import type { ExtractedContent, ExtractInput } from '@/lib/extract/types'

export type { ExtractedContent, ExtractInput, SourceType } from '@/lib/extract/types'

/** Builds a failed result for unimplemented adapters without throwing. */
function notImplemented(input: ExtractInput): ExtractedContent {
  return {
    sourceType: input.type,
    title: null,
    text: '',
    fetchedAt: new Date().toISOString(),
    sourceLabel: input.value,
    truncated: false,
    ok: false,
    error: `adapter not yet implemented: ${input.type}`,
  }
}

/**
 * Single entry point for the content-extraction layer. Dispatches to the
 * matching adapter based on `input.type`. Never throws — every failure is
 * returned as an `ExtractedContent` with `ok: false`.
 *
 * Future adapters (pdf, csv, xml, json-api) plug in by adding a case here.
 */
export async function extract(input: ExtractInput): Promise<ExtractedContent> {
  switch (input.type) {
    case 'url':
      return extractUrl(input)
    case 'pdf':
    case 'csv':
    case 'xml':
    case 'json-api':
      return notImplemented(input)
    default:
      return notImplemented(input)
  }
}
