import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildSegmentIndex,
  decimateLines,
  lineStringsFromGeojson,
  segmentsFromLines,
  type SegmentIndex,
} from './geometry'

let plates: SegmentIndex | null = null
let coast: SegmentIndex | null = null
let plateLines: ReturnType<typeof lineStringsFromGeojson> | null = null

function readGeo(fileName: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), 'lib/crisis/data', fileName), 'utf8'))
  } catch {
    return null
  }
}

export function plateIndex(): SegmentIndex {
  if (plates) return plates
  const payload = readGeo('pb2002-boundaries.json')
  const lines = payload ? lineStringsFromGeojson(payload) : []
  plateLines = lines
  plates = buildSegmentIndex(segmentsFromLines(lines), 5)
  return plates
}

export function plateLinesDecimated(step = 3): number[][][] {
  plateIndex()
  return decimateLines(plateLines ?? [], step)
}

export function coastIndex(): SegmentIndex {
  if (coast) return coast
  const payload = readGeo('ne-110m-coastline.json')
  const lines = payload ? lineStringsFromGeojson(payload) : []
  coast = buildSegmentIndex(segmentsFromLines(lines), 2)
  return coast
}
