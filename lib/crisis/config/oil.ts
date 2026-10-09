/**
 * Economies where an oil price move changes household or state budgets fast:
 * large net importers with thin reserves or fuel subsidies, and exporters whose
 * budgets ride on crude. Used only to add Brent/WTI context lines to cards.
 * Status: ai_seed_unverified
 */
export const OIL_IMPORT_DEPENDENT_ISO3 = [
  'LKA', 'PAK', 'BGD', 'NPL', 'IND', 'KEN', 'ETH', 'UGA', 'TZA', 'MWI', 'ZMB', 'MOZ',
  'EGY', 'JOR', 'LBN', 'TUN', 'MAR', 'PHL', 'MMR', 'LAO', 'KHM', 'HTI', 'JAM', 'DOM',
  'GHA', 'SEN', 'MDG', 'MUS', 'MDV', 'FJI', 'PNG', 'ZWE', 'SLE', 'LBR',
] as const

export const OIL_EXPORT_DEPENDENT_ISO3 = [
  'NGA', 'AGO', 'IRQ', 'LBY', 'VEN', 'SSD', 'IRN', 'SAU', 'KWT', 'OMN', 'BHR', 'QAT',
  'ARE', 'DZA', 'GAB', 'COG', 'GNQ', 'TCD', 'AZE', 'KAZ', 'RUS', 'ECU', 'TTO', 'BRN',
  'TLS', 'YEM', 'SDN',
] as const

const OIL_SET = new Set<string>([...OIL_IMPORT_DEPENDENT_ISO3, ...OIL_EXPORT_DEPENDENT_ISO3])

export function isOilDependentIso3(iso3: string | null | undefined): boolean {
  return Boolean(iso3 && OIL_SET.has(iso3.toUpperCase()))
}
