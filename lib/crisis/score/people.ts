import { clamp, logNorm } from './math'
import { INFORM, PEOPLE } from './thresholds'

export function peopleNorm(urbanPop: number, informExposure: number | null): number {
  const urban = logNorm(urbanPop, PEOPLE.logCap)
  const exposure = informExposure != null ? clamp(informExposure / INFORM.scale) : 0
  return clamp(PEOPLE.urbanWeight * urban + PEOPLE.exposureWeight * exposure)
}
