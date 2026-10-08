export function extractXmlTag(block: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i')
  const match = re.exec(block)
  if (!match) return null
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || null
}

export function extractXmlAttr(block: string, tag: string, attr: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<${escaped}\\b([^>]*?)\\/?>`, 'i')
  const match = re.exec(block)
  if (!match) return null
  const attrRe = new RegExp(`${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`, 'i')
  const found = attrRe.exec(match[1])
  return found?.[1] ?? null
}

export function parseXmlItems(xml: string): string[] {
  const items: string[] = []
  const re = /<item\b[\s\S]*?<\/item>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) items.push(match[0])
  return items
}

export function parseAtomEntries(xml: string): string[] {
  const items: string[] = []
  const re = /<entry\b[\s\S]*?<\/entry>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) items.push(match[0])
  return items
}

export function parseGeorssPoint(block: string): { lat: number | null; lon: number | null } {
  const raw = extractXmlTag(block, 'georss:point') || extractXmlTag(block, 'point')
  if (!raw) return { lat: null, lon: null }
  const parts = raw.trim().split(/\s+/)
  const lat = parseFloat(parts[0])
  const lon = parseFloat(parts[1])
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  }
}
