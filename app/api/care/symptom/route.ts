import { NextResponse } from 'next/server'
import { coreName, findInHira } from '@/lib/care/hira-match'
import { searchHospitals, type MedicalFacility } from '@/lib/care/hira'
import { askPerplexity } from '@/lib/jeju/resident-search'

/**
 * 증상 → 진료과 → 병원 목록  (stateless; no DB).
 *
 * Flow (Perplexity-first — HIRA has NO department data, so we can't filter
 * hospitals by department from HIRA alone):
 *  1. EMERGENCY safety check (Claude). If emergency → stop, tell user to call 119.
 *  2. Routine → Claude maps symptom → 진료과 + plain advice + minor flag.
 *  3. Perplexity finds SPECIFIC Jeju clinics for that 진료과, prioritizing
 *     동네 의원(1차 의료기관), excluding big general hospitals for minor symptoms.
 *  4. Claude extracts clinic names/areas/tier from the Perplexity text.
 *  5. Cross-reference each clinic against the HIRA Jeju list to get VERIFIED
 *     phone/address/type. If not found in HIRA → show name + area only (no
 *     invented phone), marked source='perplexity'.
 *  6. Order clinics-first (의원 before 병원 before 종합병원).
 *
 * SAFETY: never diagnose; always append a disclaimer to see a real doctor;
 * never invent a phone number.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

interface ClaudeTriage {
  emergency: boolean
  department: string
  advice: string
  minor: boolean
}

interface ExtractedClinic {
  name: string
  area: string
  tier: string // 의원 | 병원 | 종합병원 | 대학병원 | 모름
}

interface ResultHospital {
  name: string
  addr: string | null
  tel: string | null
  type: string | null
  sgguCdNm: string | null
  area: string | null
  source: 'hira' | 'perplexity'
}

// ── Claude call helper ──────────────────────────────────────────────────────

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
      console.error(`[symptom] anthropic http ${res.status}`)
      return null
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { message: string }
    }
    if (json.error) throw new Error(json.error.message)
    return json.content?.find((b) => b.type === 'text')?.text ?? ''
  } catch (e) {
    console.error('[symptom] claude call failed:', e instanceof Error ? e.message : e)
    return null
  }
}

// ── 1+2) Emergency triage + department mapping ─────────────────────────────────

const TRIAGE_SYSTEM = `당신은 어르신을 돕는 의료 안내 도우미입니다. 진단하지 말고, 아래만 판단해 순수 JSON으로만 답하세요. 마크다운 없이.

1) 응급 여부(emergency): 다음 응급 징후가 조금이라도 의심되면 반드시 true:
   - 가슴 통증·압박·조이는 느낌, 갑작스런 호흡곤란
   - 갑자기 한쪽 팔다리 마비·힘빠짐, 말이 어눌해짐, 얼굴 비대칭 (뇌졸중 의심)
   - 의식이 흐려짐·쓰러짐, 심한 어지럼
   - 멈추지 않는 심한 출혈, 심한 화상·외상
   - 갑작스런 심한 복통, 토혈·혈변
   - 자해·자살 생각, 극심한 정신적 위기
   - 그 밖에 생명이 위험할 수 있다고 판단되는 경우
   확실하지 않고 위험 가능성이 있으면 안전하게 true로 하세요.

2) 응급이 아니면(emergency=false):
   - department: 증상에 가장 알맞은 대한민국 진료과 이름 하나(한국어). 예: 정형외과, 내과, 신경과, 이비인후과, 안과, 피부과, 비뇨의학과, 산부인과, 정신건강의학과, 치과, 가정의학과 등.
   - advice: 어르신이 이해하기 쉬운 짧은 안내 2~3문장(진단이 아니라 '어느 과에 가면 되는지'와 '준비 팁' 수준).
   - minor: 가벼운/일상적인 증상이라 먼저 동네 의원(1차 의료기관)에 가도 되는 경우 true. 큰 검사나 전문 진료가 바로 필요해 보이면 false.

출력 JSON 스키마:
{
  "emergency": boolean,
  "department": "진료과 이름 (emergency=true면 빈 문자열)",
  "advice": "쉬운 안내 (emergency=true면 빈 문자열)",
  "minor": boolean
}`

async function triage(symptom: string, apiKey: string): Promise<ClaudeTriage | null> {
  const raw = await callClaude(TRIAGE_SYSTEM, `증상: "${symptom.slice(0, 800)}"`, apiKey, 500)
  if (raw === null) return null
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[0]) as Record<string, unknown>
    return {
      emergency: parsed.emergency === true,
      department: typeof parsed.department === 'string' ? parsed.department : '',
      advice: typeof parsed.advice === 'string' ? parsed.advice : '',
      minor: parsed.minor !== false, // default to minor-first unless clearly false
    }
  } catch {
    return null
  }
}

// ── 4) Extract clinic names from Perplexity prose ──────────────────────────────

const EXTRACT_SYSTEM = `아래 검색 결과 텍스트에서 해당 지역의 병·의원 이름과 위치, 종별을 추출해 순수 JSON 배열로만 출력하세요. 마크다운 없이.
텍스트에 실제로 등장하는 기관만 추출하세요. 새로 만들어내지 마세요. 없으면 빈 배열 [].

각 항목 스키마:
{ "name": "기관 이름", "area": "시/동 등 위치(모르면 빈 문자열)", "tier": "의원" | "병원" | "종합병원" | "대학병원" | "모름" }

출력: 위 객체들의 JSON 배열만.`

async function extractClinics(pplxText: string, apiKey: string): Promise<ExtractedClinic[]> {
  if (!pplxText.trim()) return []
  const raw = await callClaude(EXTRACT_SYSTEM, `검색 결과:\n"""\n${pplxText.slice(0, 4000)}\n"""`, apiKey, 800)
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
        tier: typeof x.tier === 'string' ? x.tier.trim() : '모름',
      }))
      .filter((c) => c.name.length >= 2)
  } catch {
    return []
  }
}

/** Tier rank for ordering (clinics first). */
function tierRank(type: string | null | undefined): number {
  const t = type ?? ''
  if (t.includes('의원') || t.includes('한의원') || t.includes('치과의원')) return 0
  if (t.includes('상급종합')) return 3
  if (t.includes('종합병원')) return 2
  if (t.includes('대학')) return 3
  if (t.includes('병원')) return 1
  return 1 // unknown → middle
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const symptom = typeof body.symptom === 'string' ? body.symptom.trim() : ''
  if (!symptom) {
    return NextResponse.json({ error: '증상을 입력해 주세요.' }, { status: 400 })
  }
  // Residence context (from the client). Falls back to 서울 so we never break.
  const sidoCd = typeof body.sidoCd === 'string' && /^\d{6}$/.test(body.sidoCd) ? body.sidoCd : '110000'
  const regionLabel = typeof body.regionLabel === 'string' && body.regionLabel.trim() ? body.regionLabel.trim() : '우리 지역'

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  // 1+2) Triage
  const t = await triage(symptom, apiKey)
  if (!t) {
    return NextResponse.json(
      { error: '지금은 확인이 어려워요. 잠시 후 다시 시도하시거나, 급하시면 119에 전화하세요.' },
      { status: 502 }
    )
  }

  // Emergency → stop immediately
  if (t.emergency) {
    return NextResponse.json({
      emergency: true,
      message: '지금 바로 119에 전화하시거나 응급실로 가세요.',
    })
  }

  const department = t.department || '가정의학과'

  // 3) Perplexity — find specific Jeju clinics (clinic-first)
  const tierHint = t.minor
    ? '가벼운 증상이니 종합병원·대학병원은 제외하고, 동네 의원(1차 의료기관)을 우선해서 알려줘.'
    : '동네 의원을 우선하되, 큰 검사가 필요할 수 있으면 종합병원도 하나 정도 참고로 알려줘.'
  const { text: pplxText, citations } = await askPerplexity(
    `${regionLabel}에서 "${department}" 진료를 받을 수 있는 동네 의원(1차 의료기관) 위주로 알려줘. ${tierHint} 각 병원의 이름과 위치(시·군·구·동)를 구체적으로 알려줘.`,
    {
      systemPrompt:
        `당신은 ${regionLabel} 의료기관 정보를 찾는 검색 도우미입니다. 실제로 존재하는 기관만, 이름과 위치 위주로 구체적으로 한국어로 정리하세요. 동네 의원(의원급)을 우선하고, 추측하지 말고 확인되는 정보만 제시하세요.`,
      maxTokens: 700,
    }
  )

  // 4) Extract structured clinics from the prose
  const extracted = await extractClinics(pplxText, apiKey)

  // 5) HIRA fact list for verification
  let hira: MedicalFacility[] = []
  try {
    hira = await searchHospitals({ sidoCd, fetchLimit: 1500, limit: 1500 })
  } catch (e) {
    console.error('[symptom] HIRA fetch failed:', e instanceof Error ? e.message : e)
  }

  let hospitals: ResultHospital[] = []
  const seen = new Set<string>()

  for (const clinic of extracted) {
    const match = findInHira(clinic.name, hira, { areaHint: clinic.area })
    if (match) {
      const key = coreName(match.name)
      if (seen.has(key)) continue
      seen.add(key)
      hospitals.push({
        name: match.name,
        addr: match.addr || null,
        tel: match.tel,
        type: match.type,
        sgguCdNm: match.sgguCdNm,
        area: clinic.area || match.sgguCdNm || null,
        source: 'hira',
      })
    } else {
      const key = coreName(clinic.name)
      if (seen.has(key)) continue
      seen.add(key)
      hospitals.push({
        name: clinic.name,
        addr: null,
        tel: null, // never invent a phone number
        type: clinic.tier === '모름' ? null : clinic.tier,
        sgguCdNm: null,
        area: clinic.area || null,
        source: 'perplexity',
      })
    }
  }

  // Fallback: Perplexity/extraction yielded nothing — offer nearby 의원 from HIRA
  // (not department-verified, clearly a light suggestion; disclaimer covers it).
  if (hospitals.length === 0 && hira.length > 0) {
    hospitals = hira
      .filter((h) => tierRank(h.type) === 0)
      .slice(0, 8)
      .map((h) => ({
        name: h.name,
        addr: h.addr || null,
        tel: h.tel,
        type: h.type,
        sgguCdNm: h.sgguCdNm,
        area: h.sgguCdNm || null,
        source: 'hira' as const,
      }))
  }

  // 6) Order clinics-first, then by verified (hira) before search-only
  hospitals.sort((a, b) => {
    const tr = tierRank(a.type) - tierRank(b.type)
    if (tr !== 0) return tr
    if (a.source !== b.source) return a.source === 'hira' ? -1 : 1
    return 0
  })
  hospitals = hospitals.slice(0, 12)

  const tierNote = t.minor
    ? '가벼운 증상은 동네 의원부터 가보세요. 큰 병원은 의뢰가 필요할 수 있어요.'
    : null

  return NextResponse.json({
    emergency: false,
    department,
    advice: t.advice,
    minor: t.minor,
    tierNote,
    hospitals,
    sources: citations,
    disclaimer: '정확한 진단은 의사에게 확인하세요.',
  })
}
