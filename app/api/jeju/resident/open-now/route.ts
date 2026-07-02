import { NextResponse } from 'next/server'
import { searchHospitals, searchPharmacies, type MedicalFacility } from '@/lib/jeju/hira'
import { askPerplexity } from '@/lib/jeju/resident-search'

/**
 * 지금 문 연 곳 — open-now hospitals & pharmacies in Jeju (stateless).
 *
 * Input:  POST { kind: '병원' | '약국', area?: '제주시' | '서귀포시' }
 *
 * Flow:
 *  1. Ask Perplexity with current KST date/time → find open-now places
 *     (야간진료, 공휴일, 24시 약국, 응급실, 당번약국 특히 우선).
 *  2. Claude extracts { name, area, hoursNote } from the prose.
 *  3. Cross-reference against HIRA for verified phone / address.
 *     Perplexity-only results show name+area, never an invented phone.
 *
 * HONESTY: hours change and Perplexity may be stale → always return the
 * 전화 확인 disclaimer and surface the emergency line.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

interface ExtractedPlace {
  name: string
  area: string
  hoursNote: string
}

interface ResultItem {
  name: string
  area: string | null
  addr: string | null
  tel: string | null
  type: string | null
  hoursNote: string | null
  source: 'hira' | 'perplexity'
}

// ── Claude helper ────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string, apiKey: string, maxTokens = 500): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) {
      console.error(`[open-now] anthropic http ${res.status}`)
      return null
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)
    return json.content?.find((b) => b.type === 'text')?.text ?? ''
  } catch (e) {
    console.error('[open-now] claude call failed:', e instanceof Error ? e.message : e)
    return null
  }
}

// ── Extract places from Perplexity prose ─────────────────────────────────────

const EXTRACT_SYSTEM = `아래 검색 결과 텍스트에서 제주 지역에서 지금 운영 중이거나 야간·공휴일에 운영하는 병원·의원·약국의 이름, 위치, 운영시간 메모를 추출해 순수 JSON 배열로만 출력하세요. 마크다운 없이.
텍스트에 실제로 등장하는 기관만 추출하세요. 새로 만들어내지 마세요. 없으면 빈 배열 [].

각 항목 스키마:
{ "name": "기관 이름", "area": "위치(모르면 빈 문자열)", "hoursNote": "운영 특이사항(예: 24시간, 야간진료, 공휴일 운영, 당번약국 등; 모르면 빈 문자열)" }

출력: 위 객체들의 JSON 배열만.`

async function extractPlaces(pplxText: string, apiKey: string): Promise<ExtractedPlace[]> {
  if (!pplxText.trim()) return []
  const raw = await callClaude(
    EXTRACT_SYSTEM,
    `검색 결과:\n"""\n${pplxText.slice(0, 4000)}\n"""`,
    apiKey,
    800
  )
  if (raw === null) return []
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as unknown[]
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        name: typeof x.name === 'string' ? x.name.trim() : '',
        area: typeof x.area === 'string' ? x.area.trim() : '',
        hoursNote: typeof x.hoursNote === 'string' ? x.hoursNote.trim() : '',
      }))
      .filter((p) => p.name.length >= 2)
  } catch {
    return []
  }
}

// ── HIRA fuzzy match (same logic as symptom route) ───────────────────────────

function coreName(s: string): string {
  return s
    .replace(/의료법인|사회복지법인|재단법인|재단|\(.*?\)|\s+|·|,|\./g, '')
    .toLowerCase()
}

function findInHira(name: string, hira: MedicalFacility[]): MedicalFacility | null {
  const target = coreName(name)
  if (target.length < 2) return null
  let best: MedicalFacility | null = null
  let bestLen = Infinity
  for (const h of hira) {
    const hc = coreName(h.name)
    if (hc.length < 2) continue
    if (hc === target || hc.includes(target) || target.includes(hc)) {
      if (hc.length < bestLen) {
        best = h
        bestLen = hc.length
      }
    }
  }
  return best
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
  if (kind !== '병원' && kind !== '약국') {
    return NextResponse.json({ error: '병원 또는 약국을 선택해 주세요.' }, { status: 400 })
  }

  const area = typeof body.area === 'string' ? body.area.trim() : ''
  const areaFilter = area === '제주시' || area === '서귀포시' ? area : undefined

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  // Current KST time (UTC+9) so Perplexity knows when "now" is
  const nowKST = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const areaHint = areaFilter ? `${areaFilter} 내` : '제주도 전역'
  const kindHint =
    kind === '약국'
      ? '24시간 약국, 야간 운영 약국, 당번 약국'
      : '야간진료 병원·의원, 공휴일 진료 의원, 24시간 응급실'

  // 1) Perplexity — find open-now places with real-world search
  const { text: pplxText, citations } = await askPerplexity(
    `현재 시각 ${nowKST} 기준으로 ${areaHint}에서 지금 문 열어 있는 ${kind}을 알려줘. 특히 ${kindHint}을 우선해서 이름, 위치(시·동), 운영시간 정보를 구체적으로 알려줘.`,
    {
      systemPrompt:
        '당신은 제주 지역 의료기관 및 약국 운영 현황을 찾는 검색 도우미입니다. 현재 운영 중이거나 야간·공휴일에 운영하는 곳만, 이름·위치·운영시간 위주로 한국어로 구체적으로 정리하세요. 추측하지 말고 확인된 정보만 제시하세요.',
      maxTokens: 800,
    }
  )

  // 2) Extract structured places from the Perplexity prose
  const extracted = await extractPlaces(pplxText, apiKey)

  // 3) HIRA fact list for phone/address verification
  let hira: MedicalFacility[] = []
  try {
    const opts = {
      region: 'jeju',
      fetchLimit: 1500,
      limit: 1500,
      sgguCdNm: areaFilter,
    }
    hira = kind === '약국' ? await searchPharmacies(opts) : await searchHospitals(opts)
  } catch (e) {
    console.error('[open-now] HIRA fetch failed:', e instanceof Error ? e.message : e)
  }

  const items: ResultItem[] = []
  const seen = new Set<string>()

  for (const place of extracted) {
    const match = findInHira(place.name, hira)
    if (match) {
      const key = coreName(match.name)
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        name: match.name,
        area: place.area || match.sgguCdNm || null,
        addr: match.addr || null,
        tel: match.tel,
        type: match.type,
        hoursNote: place.hoursNote || null,
        source: 'hira',
      })
    } else {
      const key = coreName(place.name)
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        name: place.name,
        area: place.area || null,
        addr: null,
        tel: null, // never invent a phone number
        type: null,
        hoursNote: place.hoursNote || null,
        source: 'perplexity',
      })
    }
  }

  return NextResponse.json({
    items: items.slice(0, 12),
    advice: '급하시면 119에 전화하시거나 응급실로 바로 가세요.',
    disclaimer: '영업 시간은 바뀔 수 있으니, 가시기 전에 꼭 전화로 확인하세요.',
    sources: citations,
  })
}
