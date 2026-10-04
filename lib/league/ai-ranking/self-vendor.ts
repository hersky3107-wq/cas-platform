/**
 * Analysis-only self-vendor flags. A seat is self-vendor when its roster
 * vendor brand equals the AIRANK subject (or param) brand.
 */

import { mapVendorBrand, type MappedVendorBrand } from './brands'
import { decodeAirankInstrument } from './instrument'

export type SelfVendorFlags = {
  vendorBrand: MappedVendorBrand
  subjectBrand: string | null
  paramBrand: string | null
  isSubjectVendor: boolean
  isParamVendor: boolean
}

export function selfVendorFlags(
  seat: { model_id: string; brand: string },
  instrument: string,
): SelfVendorFlags {
  const vendorBrand = mapVendorBrand(seat.brand, seat.model_id).brand
  const parts = decodeAirankInstrument(instrument)
  const subjectBrand = parts && parts.kind !== 'model_rank1' ? parts.subject : null
  const paramBrand = parts?.kind === 'brand_above' ? (parts.param ?? null) : null
  return {
    vendorBrand,
    subjectBrand,
    paramBrand,
    isSubjectVendor: Boolean(subjectBrand && vendorBrand === subjectBrand),
    isParamVendor: Boolean(paramBrand && vendorBrand === paramBrand),
  }
}

export function formatSelfVendorMarker(flags: SelfVendorFlags): string {
  return `[self_vendor subject=${flags.isSubjectVendor ? '1' : '0'} param=${flags.isParamVendor ? '1' : '0'} brand=${flags.vendorBrand}]`
}
