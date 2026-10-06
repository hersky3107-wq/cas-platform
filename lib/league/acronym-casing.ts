/**
 * Acronym and brand casing for text rebuilt from lowercase instrument slugs
 * (TECH:OPEN subject / object). Only whole ASCII tokens change, so Korean
 * particles stay attached ("새 gpu를" → "새 GPU를"). Pure, client-safe.
 */

const UPPER = new Set([
  'ai', 'agi', 'api', 'ar', 'vr', 'xr', 'cpu', 'gpu', 'npu', 'tpu', 'apu', 'dpu', 'asic', 'fpga', 'soc',
  'hbm', 'dram', 'nand', 'ssd', 'hdd', 'oled', 'lcd', 'usb', 'ev', 'llm', 'sdk', 'os', 'pc', 'tv',
  'lte', 'nfc', 'uwb', 'hdr', 'rtx', 'gtx', 'dlss', 'cuda', 'esg', 'ipo', 'fda', 'nasa', 'amd', 'ibm',
  'tsmc', 'lg', 'sk', 'hp', 'bmw', 'byd', 'vpn', 'nft', 'ui', 'ux',
])

const PROPER: Record<string, string> = {
  iphone: 'iPhone',
  ipad: 'iPad',
  ipados: 'iPadOS',
  ios: 'iOS',
  macos: 'macOS',
  watchos: 'watchOS',
  visionos: 'visionOS',
  macbook: 'MacBook',
  imac: 'iMac',
  airpods: 'AirPods',
  icloud: 'iCloud',
  chatgpt: 'ChatGPT',
  openai: 'OpenAI',
  geforce: 'GeForce',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  youtube: 'YouTube',
  github: 'GitHub',
  tiktok: 'TikTok',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  nvidia: 'NVIDIA',
  iot: 'IoT',
  wifi: 'Wi-Fi',
  '4k': '4K',
  '8k': '8K',
  '5g': '5G',
  '6g': '6G',
}

/** Chip / model codes: m4 → M4, h200 → H200, rtx5090 → RTX5090, gb300 → GB300. */
const CODE = /^(rtx|gtx|gb|[a-z]{1,2})(\d{1,4})$/

const TOKEN = /[A-Za-z0-9]+/g

function casedToken(token: string): string | null {
  const lower = token.toLowerCase()
  if (PROPER[lower]) return PROPER[lower]
  if (UPPER.has(lower)) return lower.toUpperCase()
  if (lower.endsWith('s') && UPPER.has(lower.slice(0, -1)) && lower !== 'os') return `${lower.slice(0, -1).toUpperCase()}s`
  const code = CODE.exec(lower)
  if (code) return `${code[1].toUpperCase()}${code[2]}`
  return null
}

/** "새 gpu" → "새 GPU", "new ai chips" → "new AI chips". Other tokens keep their case. */
export function restoreAcronymCasing(text: string): string {
  return text.replace(TOKEN, (token) => casedToken(token) ?? token)
}

/** Names rebuilt from a slug: known brands and acronyms, else Title Case for all-lowercase ASCII words. */
export function properNameCasing(text: string): string {
  return text.replace(TOKEN, (token) => {
    const cased = casedToken(token)
    if (cased) return cased
    return /^[a-z]/.test(token) && token === token.toLowerCase() ? token[0].toUpperCase() + token.slice(1) : token
  })
}

function replaceBounded(text: string, needle: string, replacement: string): string {
  if (!needle || needle === replacement) return text
  let out = ''
  let from = 0
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, from)) {
    const before = text[at - 1] ?? ''
    const after = text[at + needle.length] ?? ''
    const bounded = !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)
    out += text.slice(from, at) + (bounded ? replacement : needle)
    from = at + needle.length
  }
  return out + text.slice(from)
}

/**
 * Display fix for rounds stored before casing was restored at compose time:
 * swaps the lowercase TECH:OPEN object / subject for its cased form.
 */
export function restoreTechOpenCasing(instrument: string | null | undefined, text: string): string {
  const parts = instrument?.split(':')
  if (!parts || parts.length !== 7 || parts[0] !== 'TECH' || parts[1] !== 'OPEN') return text
  const subject = parts[2].replace(/_/g, ' ').trim()
  const object = parts[4].replace(/_/g, ' ').trim()
  let out = replaceBounded(text, object, restoreAcronymCasing(object))
  out = replaceBounded(out, subject, properNameCasing(subject))
  return out
}
