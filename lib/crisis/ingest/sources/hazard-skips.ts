import type { CrisisSource, IngestFetchResult } from '../types'

export const lhasaSource: CrisisSource = {
  key: 'lhasa',
  department: 'natural',
  scheduleMinutes: 1440,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    return {
      httpCalls: 0,
      skipped: 'NASA LHASA nowcast is a global 1 km daily grid at GES DISC, not a point feed. Raster not pulled.',
      signals: [],
    }
  },
}

export const promedSource: CrisisSource = {
  key: 'promed',
  department: 'health',
  scheduleMinutes: 1440,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    return {
      httpCalls: 0,
      skipped: 'ProMED has no open outbreak feed. The public posts API is a blog and /api/alerts is missing.',
      signals: [],
    }
  },
}

export const locustSource: CrisisSource = {
  key: 'locust',
  department: 'natural',
  scheduleMinutes: 1440,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    return {
      httpCalls: 0,
      skipped: 'FAO Locust Hub search returned no country situation layer, and the current-situation page was 404.',
      signals: [],
    }
  },
}
