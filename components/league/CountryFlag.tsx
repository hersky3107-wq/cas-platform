import { CAMP_LABEL, type Camp } from '@/lib/league/card-types'

/**
 * Country flag chip for a model tile — keyed by the model's HOME COUNTRY
 * (US / CN / KR / FR / CA), not just its league camp. The roster's camp axis
 * (us/china/other) stays as-is; this component only affects presentation.
 *
 * Flags are tiny CSS renderings (no emoji — Windows doesn't render flag
 * emoji), each paired with the ISO country code so the meaning never depends
 * on recognizing the flag. Accuracy notes:
 *  - US: red/white horizontal stripes + blue canton (the previous vertical
 *    blue/white/red tri-stripe read as FRANCE — the reported bug).
 *  - FR: vertical blue/white/red thirds (what US previously drew by mistake).
 *  - CA: vertical red/white/red thirds.
 *  - KR: white field + red/blue taegeuk disc (needs the light border).
 *  - CN: red field + gold star.
 */

export type CountryCode = 'US' | 'CN' | 'KR' | 'FR' | 'CA' | 'INT'

/** Roster brand → home country. Unknown brands fall back to the camp axis. */
const BRAND_COUNTRY: Record<string, CountryCode> = {
  OpenAI: 'US',
  Anthropic: 'US',
  Google: 'US',
  xAI: 'US',
  Meta: 'US',
  'Meta Muse': 'US',
  NVIDIA: 'US',
  Amazon: 'US',
  Microsoft: 'US',
  Perplexity: 'US',
  'You.com': 'US',
  Qwen: 'CN',
  DeepSeek: 'CN',
  'Moonshot AI': 'CN',
  'Z.ai': 'CN',
  MiniMax: 'CN',
  Xiaomi: 'CN',
  Baidu: 'CN',
  ByteDance: 'CN',
  Upstage: 'KR',
  NAVER: 'KR',
  LG: 'KR',
  Mistral: 'FR',
  Cohere: 'CA',
}

const CAMP_FALLBACK: Record<Camp, CountryCode> = { us: 'US', china: 'CN', other: 'INT' }

const COUNTRY_NAME: Record<CountryCode, string> = {
  US: 'United States',
  CN: 'China',
  KR: 'South Korea',
  FR: 'France',
  CA: 'Canada',
  INT: 'International',
}

export function brandCountry(brand: string, camp: Camp): CountryCode {
  return BRAND_COUNTRY[brand] ?? CAMP_FALLBACK[camp]
}

export function CountryFlag({ brand, camp }: { brand: string; camp: Camp }) {
  const code = brandCountry(brand, camp)
  return (
    <span
      dir="ltr"
      className="inline-flex shrink-0 items-center gap-1.5 rounded bg-white/80 px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-league-fg-muted"
      title={`${COUNTRY_NAME[code]} · ${CAMP_LABEL[camp]}`}
    >
      <span
        className="relative flex h-4 w-6 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-inset ring-black/10"
        aria-hidden
      >
        <FlagGlyph code={code} />
      </span>
      {code}
    </span>
  )
}

function FlagGlyph({ code }: { code: CountryCode }) {
  switch (code) {
    case 'US':
      return (
        <>
          <span
            className="absolute inset-0"
            style={{
              background:
                'repeating-linear-gradient(to bottom, #b91c1c 0px, #b91c1c 1.4px, #ffffff 1.4px, #ffffff 2.8px)',
            }}
          />
          <span className="absolute left-0 top-0 h-[55%] w-[45%] bg-blue-800" />
        </>
      )
    case 'CN':
      return (
        <span className="absolute inset-0 bg-red-600">
          <span className="absolute left-[2px] top-[1px] text-[9px] leading-none text-yellow-300">★</span>
        </span>
      )
    case 'KR':
      return (
        <span className="absolute inset-0 items-center justify-center bg-white">
          <span
            className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: 'conic-gradient(#cd2e3a 0deg 180deg, #0047a0 180deg 360deg)' }}
          />
        </span>
      )
    case 'FR':
      return (
        <>
          <span className="h-full w-1/3 bg-blue-700" />
          <span className="h-full w-1/3 bg-white" />
          <span className="h-full w-1/3 bg-red-600" />
        </>
      )
    case 'CA':
      return (
        <>
          <span className="h-full w-1/4 bg-red-600" />
          <span className="h-full w-1/2 bg-white" />
          <span className="h-full w-1/4 bg-red-600" />
        </>
      )
    default:
      return <span className="h-full w-full bg-slate-400" />
  }
}
