import { CAMP_LABEL, type Camp } from '@/lib/league/card-types'
import { brandCountry, COUNTRY_NAME, FLAG_SRC } from '@/lib/league/country'

/**
 * Country flag chip for a model tile — keyed by the model's HOME COUNTRY
 * (US / CN / KR / FR / CA), not just its league camp. The roster's camp axis
 * (us/china/other) stays as-is; this component only affects presentation.
 *
 * Flags are locally bundled SVGs from flag-icons (MIT) — no CDN, no emoji,
 * no font. See `public/league/flags/LICENSE.md`.
 */

export { brandCountry }
export type { CountryCode } from '@/lib/league/country'

export function CountryFlag({ brand, camp }: { brand: string; camp: Camp }) {
  const code = brandCountry(brand, camp)
  const name = COUNTRY_NAME[code]
  return (
    <span
      dir="ltr"
      className="inline-flex shrink-0 items-center rounded bg-white/80 px-1 py-1"
      title={`${name} · ${CAMP_LABEL[camp]}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local static SVG, not a remote image */}
      <img
        src={FLAG_SRC[code]}
        alt={name}
        title={code}
        width={24}
        height={16}
        className="h-4 w-6 rounded-[3px] object-cover ring-1 ring-inset ring-black/10"
      />
    </span>
  )
}
