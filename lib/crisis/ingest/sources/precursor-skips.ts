import type { CrisisSource, IngestFetchResult } from '../types'

/** Weekly RSS and the reports page returned HTTP 403 on 2026-10-10. */
export const gvpWeeklySource: CrisisSource = {
  key: 'gvp_weekly',
  department: 'geology',
  scheduleMinutes: 720,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    return {
      httpCalls: 0,
      skipped: 'Smithsonian GVP weekly RSS returned HTTP 403',
      signals: [],
    }
  },
}

/** SACS notification URL returned HTTP 404. No open daily point file was found. */
export const so2DailySource: CrisisSource = {
  key: 'so2_daily',
  department: 'geology',
  scheduleMinutes: 720,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    return {
      httpCalls: 0,
      skipped: 'No open daily SO2 point product (SACS notification HTTP 404; Earthdata grids not pulled)',
      signals: [],
    }
  },
}

/** CDI is a Europe WCS raster. A global grid is too heavy for this sweep. */
export const gdoCdiSource: CrisisSource = {
  key: 'gdo_cdi',
  department: 'hydro_weather',
  scheduleMinutes: 10080,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    return {
      httpCalls: 0,
      skipped: 'GDO/EDO CDI is a Copernicus WCS raster (Europe coverage cdiad), not a point feed. Global grid not pulled.',
      signals: [],
    }
  },
}

/** Nevada Geodetic Lab daily holdings timed out and the full series is too heavy. */
export const gnssNglSource: CrisisSource = {
  key: 'gnss_ngl',
  department: 'geology',
  scheduleMinutes: 1440,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    return {
      httpCalls: 0,
      skipped: 'Nevada Geodetic Lab GNSS daily series skipped (endpoint timed out; holdings are too heavy)',
      signals: [],
    }
  },
}
