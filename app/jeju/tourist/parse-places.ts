/**
 * Parses the VisitJeju summary string produced by `renderVisitJejuAttractions`
 * (in lib/jeju/connectors.ts) back into per-card fields.
 *
 * Each data line looks like:
 *   `- [분류] 제목 (시·구역) | 태그: ... | 좌표: lat,long | 소개: ...`
 *
 * Parsing a rendered summary is inherently fragile (the connector only exposes
 * `fetchJejuSource` returning pre-rendered text, and must not be modified), so
 * this is deliberately defensive: lines that don't match the head pattern are
 * skipped, and every trailing segment is optional.
 */
export type ParsedPlace = {
  category: string
  title: string
  region: string | null
  tag: string | null
  coords: string | null
  intro: string | null
}

export function parsePlaces(text: string): ParsedPlace[] {
  if (!text) return []

  const out: ParsedPlace[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('- ')) continue

    const segments = line.slice(2).split(' | ')
    const head = (segments[0] ?? '').trim()

    // head = "[분류] 제목 (시·구역)" — 분류 is required to count as a place line.
    const headMatch = head.match(/^\[([^\]]*)\]\s*(.*)$/)
    if (!headMatch) continue

    const category = (headMatch[1] ?? '').trim()
    let titlePart = (headMatch[2] ?? '').trim()

    // Region is the trailing "(...)" with no nested parens; titles may contain
    // their own parentheses, so only strip a parenthetical at the very end.
    let region: string | null = null
    const regionMatch = titlePart.match(/\(([^()]*)\)\s*$/)
    if (regionMatch && typeof regionMatch.index === 'number') {
      region = (regionMatch[1] ?? '').trim() || null
      titlePart = titlePart.slice(0, regionMatch.index).trim()
    }

    const title = titlePart || '(제목 없음)'

    let tag: string | null = null
    let coords: string | null = null
    let intro: string | null = null

    for (const seg of segments.slice(1)) {
      const s = seg.trim()
      if (s.startsWith('태그:')) tag = s.slice('태그:'.length).trim() || null
      else if (s.startsWith('좌표:')) coords = s.slice('좌표:'.length).trim() || null
      else if (s.startsWith('소개:')) intro = s.slice('소개:'.length).trim() || null
    }

    out.push({ category, title, region, tag, coords, intro })
  }

  return out
}
