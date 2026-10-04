/**
 * Analysis-only self-vendor flags. A seat is self-vendor when its roster
 * vendor brand equals the AIRANK subject (or param) brand, or belongs to
 * the queried camp. Markers are never written into reasoning_text.
 */

import { campOfBrand, mapVendorBrand, type MappedVendorBrand } from './brands'
import { decodeAirankInstrument } from './instrument'

export const SELF_VENDOR_MARKER_RE = /\[self_vendor[^\]]*\]/gi

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
  const campKind = parts?.kind === 'camp_rank1' || parts?.kind === 'camp_topn'
  const subjectBrand = parts && parts.kind !== 'model_rank1' && !campKind ? parts.subject : null
  const paramBrand = parts?.kind === 'brand_above' ? (parts.param ?? null) : null
  const isSubjectVendor = campKind
    ? campOfBrand(vendorBrand) === parts?.subject
    : Boolean(subjectBrand && vendorBrand === subjectBrand)
  return {
    vendorBrand,
    subjectBrand: campKind ? parts?.subject ?? null : subjectBrand,
    paramBrand,
    isSubjectVendor,
    isParamVendor: Boolean(paramBrand && vendorBrand === paramBrand),
  }
}

export function formatSelfVendorMarker(flags: SelfVendorFlags): string {
  return `[self_vendor subject=${flags.isSubjectVendor ? '1' : '0'} param=${flags.isParamVendor ? '1' : '0'} brand=${flags.vendorBrand}]`
}

export function stripSelfVendorMarkers(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const out = text.replace(SELF_VENDOR_MARKER_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return out || null
}
