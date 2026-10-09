/**
 * One small call per new source to record auth and response shape.
 * Prints status and a redacted body head. No database writes.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/probe-new-sources.ts [--only=reliefweb,metaculus,...]
 */
import { redactSecrets } from '../../lib/crisis/ingest/fetch'

const only = process.argv.find((item) => item.startsWith('--only='))?.slice(7).split(',') ?? null

function want(key: string): boolean {
  return !only || only.includes(key)
}

function head(value: unknown, max = 1200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return redactSecrets(text ?? '').slice(0, max)
}

async function call(label: string, url: string, init: RequestInit = {}): Promise<{ status: number; text: string; type: string }> {
  const started = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) })
    const text = await res.text()
    const type = res.headers.get('content-type') ?? ''
    console.log(`[${label}] HTTP ${res.status} ${type} ${Date.now() - started}ms bytes=${text.length}`)
    return { status: res.status, text, type }
  } catch (error) {
    console.log(`[${label}] fetch error ${error instanceof Error ? error.message : String(error)}`)
    return { status: 0, text: '', type: '' }
  }
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

async function reliefweb(): Promise<void> {
  const app = process.env.RELIEFWEB_APPNAME ?? ''
  const reports = await call('reliefweb reports', `https://api.reliefweb.int/v2/reports?appname=${encodeURIComponent(app)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      limit: 3,
      preset: 'latest',
      fields: { include: ['title', 'url', 'url_alias', 'date.created', 'date.original', 'country.iso3', 'primary_country.iso3', 'disaster_type.name', 'source.shortname', 'disaster.name'] },
      filter: { field: 'primary_country.iso3', value: 'lka' },
    }),
  })
  console.log(head(reports.text))
  const disasters = await call('reliefweb disasters', `https://api.reliefweb.int/v2/disasters?appname=${encodeURIComponent(app)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      limit: 2,
      preset: 'latest',
      fields: { include: ['name', 'url', 'date.created', 'country.iso3', 'primary_country.iso3', 'type.name', 'status', 'glide'] },
    }),
  })
  console.log(head(disasters.text, 800))
}

async function metaculus(): Promise<void> {
  const token = process.env.METACULUS_TOKEN ?? ''
  const res = await call('metaculus posts', 'https://www.metaculus.com/api/posts/?statuses=open&limit=2&order_by=-hotness&forecast_type=binary&with_cp=true', {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  })
  try {
    const json = JSON.parse(res.text) as { results?: Array<Record<string, unknown>>; next?: string; count?: number }
    console.log(`count=${json.count} next=${json.next}`)
    const first = json.results?.[0]
    if (first) {
      console.log(`post keys=${Object.keys(first).join(',')}`)
      const question = first.question as Record<string, unknown> | undefined
      console.log(`question keys=${question ? Object.keys(question).join(',') : '-'}`)
      console.log(head({ id: first.id, title: first.title, slug: first.slug, projects: first.projects, question: question ? { scheduled_close_time: question.scheduled_close_time, aggregations: question.aggregations, type: question.type } : null }, 2000))
    } else {
      console.log(head(res.text))
    }
  } catch {
    console.log(head(res.text))
  }
}

async function cloudflare(): Promise<void> {
  const token = process.env.CLOUDFLARE_RADAR_TOKEN ?? ''
  const res = await call('cloudflare outages', 'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=7d&limit=2&format=json', {
    headers: { Authorization: `Bearer ${token}` },
  })
  console.log(head(res.text, 1600))
}

async function eia(): Promise<void> {
  const key = process.env.EIA_API_KEY ?? ''
  const qs = [
    `api_key=${encodeURIComponent(key)}`,
    'frequency=daily',
    'data[0]=value',
    'facets[series][]=RBRTE',
    'facets[series][]=RWTC',
    'sort[0][column]=period',
    'sort[0][direction]=desc',
    'length=4',
  ].join('&')
  const res = await call('eia spot', `https://api.eia.gov/v2/petroleum/pri/spt/data/?${qs}`)
  console.log(head(res.text, 1200))
}

async function earthdataToken(): Promise<string | null> {
  const user = process.env.EARTHDATA_USERNAME ?? ''
  const pass = process.env.EARTHDATA_PASSWORD ?? ''
  const res = await call('earthdata token', 'https://urs.earthdata.nasa.gov/api/users/find_or_create_token', {
    method: 'POST',
    headers: { Authorization: basic(user, pass) },
  })
  try {
    const json = JSON.parse(res.text) as { access_token?: string; expiration_date?: string }
    console.log(`token=${json.access_token ? 'yes' : 'no'} expires=${json.expiration_date ?? '-'}`)
    return json.access_token ?? null
  } catch {
    console.log(head(res.text, 400))
    return null
  }
}

async function imerg(): Promise<void> {
  const user = process.env.EARTHDATA_USERNAME ?? ''
  const pass = process.env.EARTHDATA_PASSWORD ?? ''
  const signin = await call('giovanni signin', 'https://api.giovanni.earthdata.nasa.gov/signin', {
    headers: { Authorization: basic(user, pass) },
    redirect: 'follow',
  })
  const token = signin.text.replace(/"/g, '').trim()
  console.log(`giovanni token=${token && signin.status === 200 ? `yes len=${token.length}` : 'no'} head=${signin.status === 200 ? '' : head(signin.text, 300)}`)
  if (signin.status !== 200 || !token) return
  const end = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const start = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
  for (const data of ['GPM_3IMERGDE_07_precipitation', 'GPM_3IMERGDL_07_precipitation', 'GPM_3IMERGHHE_07_precipitation']) {
    const url = `https://api.giovanni.earthdata.nasa.gov/timeseries?data=${data}&location=[6.99,81.06]&time=${start}T00:00:00/${end}T23:59:59`
    const res = await call(`giovanni ${data}`, url, { headers: { authorizationtoken: token } })
    console.log(head(res.text, 700))
  }
}

async function blackMarble(): Promise<void> {
  const cmr = await call(
    'cmr VNP46A2',
    'https://cmr.earthdata.nasa.gov/search/granules.json?short_name=VNP46A2&point=81.06,6.99&sort_key=-start_date&page_size=2',
  )
  let dataUrl: string | null = null
  try {
    const json = JSON.parse(cmr.text) as { feed?: { entry?: Array<Record<string, unknown>> } }
    for (const entry of json.feed?.entry ?? []) {
      const links = (entry.links as Array<{ href: string; rel: string; type?: string }> | undefined) ?? []
      console.log(`granule ${entry.producer_granule_id ?? entry.title} start=${entry.time_start} size_mb=${entry.granule_size}`)
      for (const link of links) console.log(`  link rel=${link.rel.split('/').pop()} type=${link.type ?? ''} ${link.href}`)
      dataUrl = dataUrl ?? links.find((link) => /\.h5$/.test(link.href) && /data#/.test(link.rel))?.href ?? null
    }
  } catch {
    console.log(head(cmr.text, 400))
  }
  const token = await earthdataToken()
  if (dataUrl && token) {
    const res = await fetch(dataUrl, { method: 'HEAD', headers: { Authorization: `Bearer ${token}` }, redirect: 'follow', signal: AbortSignal.timeout(30_000) }).catch(() => null)
    console.log(`[laads HEAD] ${res ? `HTTP ${res.status} type=${res.headers.get('content-type')} length=${res.headers.get('content-length')}` : 'fetch error'}`)
    const dap = dataUrl.replace('/archive/allData/', '/opendap/RemoteResources/laads/allData/') + '.dmr'
    const dapRes = await call('laads opendap dmr', dap, { headers: { Authorization: `Bearer ${token}` } })
    console.log(head(dapRes.text, 300))
  }
  const gibs = await call(
    'gibs capabilities',
    'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml',
  )
  const layers = [...gibs.text.matchAll(/<ows:Identifier>([^<]*(?:Black_?Marble|DayNight|Night)[^<]*)<\/ows:Identifier>/gi)].map((match) => match[1])
  console.log(`gibs night layers=${[...new Set(layers)].join(', ') || '-'}`)
}

async function acled(): Promise<void> {
  const form = new URLSearchParams({
    username: process.env.ACLED_EMAIL ?? '',
    password: process.env.ACLED_PASSWORD ?? '',
    grant_type: 'password',
    client_id: 'acled',
  })
  const tokenRes = await call('acled oauth', 'https://acleddata.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  let token: string | null = null
  try {
    const json = JSON.parse(tokenRes.text) as { access_token?: string; token_type?: string; expires_in?: number; error?: string; error_description?: string }
    token = json.access_token ?? null
    console.log(`token=${token ? 'yes' : 'no'} type=${json.token_type ?? '-'} expires_in=${json.expires_in ?? '-'} error=${json.error ?? '-'} ${json.error_description ?? ''}`)
  } catch {
    console.log(head(tokenRes.text, 400))
  }
  if (!token) return
  const read = await call('acled read events', 'https://acleddata.com/api/acled/read?_format=json&country=Sri%20Lanka&limit=2', {
    headers: { Authorization: `Bearer ${token}` },
  })
  console.log(head(read.text, 900))
}

function shapeOf(name: string): string {
  const value = process.env[name]
  if (value === undefined) return `${name}: missing`
  return `${name}: len=${value.length} trimmed_same=${value === value.trim()} quoted=${/^["'].*["']$/.test(value)} has_at=${value.includes('@')}`
}

function cookieHeader(res: Response, jar: Map<string, string>): string {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  for (const line of raw) {
    const pair = line.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join('; ')
}

async function giovanniManual(): Promise<string | null> {
  const user = process.env.EARTHDATA_USERNAME ?? ''
  const pass = process.env.EARTHDATA_PASSWORD ?? ''
  const jar = new Map<string, string>()
  let url = 'https://api.giovanni.earthdata.nasa.gov/signin'
  for (let hop = 0; hop < 6; hop += 1) {
    const host = new URL(url).host
    const headers: Record<string, string> = {}
    if (host.includes('urs.earthdata.nasa.gov')) headers.Authorization = basic(user, pass)
    const cookies = [...jar].map(([key, value]) => `${key}=${value}`).join('; ')
    if (cookies) headers.Cookie = cookies
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    cookieHeader(res, jar)
    const location = res.headers.get('location')
    const safeUrl = url.replace(/code=[^&]+/, 'code=***')
    console.log(`[giovanni hop ${hop}] ${res.status} ${host} ${safeUrl.slice(0, 120)} -> ${location ? new URL(location, url).host : '-'}`)
    if (location && res.status >= 300 && res.status < 400) {
      url = new URL(location, url).toString()
      continue
    }
    const text = await res.text()
    if (res.status === 200 && !text.trim().startsWith('<')) return text.replace(/"/g, '').trim()
    console.log(head(text, 300))
    return null
  }
  return null
}

async function earthdata2(): Promise<void> {
  console.log(shapeOf('EARTHDATA_USERNAME'))
  console.log(shapeOf('EARTHDATA_PASSWORD'))
  const user = process.env.EARTHDATA_USERNAME ?? ''
  const pass = process.env.EARTHDATA_PASSWORD ?? ''
  const tokens = await call('earthdata tokens list', 'https://urs.earthdata.nasa.gov/api/users/tokens', {
    headers: { Authorization: basic(user, pass) },
  })
  console.log(head(tokens.text.replace(/"access_token":"[^"]+"/g, '"access_token":"***"'), 300))
  const created = await call('earthdata find_or_create_token', 'https://urs.earthdata.nasa.gov/api/users/find_or_create_token', {
    method: 'POST',
    headers: { Authorization: basic(user, pass) },
  })
  console.log(head(created.text.replace(/"access_token":"[^"]+"/g, '"access_token":"***"'), 300))
  const token = await giovanniManual()
  console.log(`giovanni token=${token ? `yes len=${token.length}` : 'no'}`)
  if (!token) return
  const end = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const start = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
  for (const data of ['GPM_3IMERGDE_07_precipitation', 'GPM_3IMERGDL_07_precipitation']) {
    const url = `https://api.giovanni.earthdata.nasa.gov/timeseries?data=${data}&location=[6.99,81.06]&time=${start}T00:00:00/${end}T23:59:59`
    const res = await call(`giovanni ${data}`, url, { headers: { authorizationtoken: token } })
    console.log(head(res.text, 900))
  }
}

async function acled2(): Promise<void> {
  console.log(shapeOf('ACLED_EMAIL'))
  console.log(shapeOf('ACLED_PASSWORD'))
  const form = new URLSearchParams({
    username: (process.env.ACLED_EMAIL ?? '').trim(),
    password: (process.env.ACLED_PASSWORD ?? '').trim(),
    grant_type: 'password',
    client_id: 'acled',
    scope: 'authenticated',
  })
  const res = await call('acled oauth scoped', 'https://acleddata.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  console.log(head(res.text.replace(/"(access|refresh)_token":"[^"]+"/g, '"$1_token":"***"'), 300))
  const legacy = await call('acled legacy api', `https://api.acleddata.com/acled/read?email=${encodeURIComponent((process.env.ACLED_EMAIL ?? '').trim())}&key=x&country=Sri%20Lanka&limit=1`)
  console.log(head(legacy.text, 300))
}

async function metaculus2(): Promise<void> {
  const token = process.env.METACULUS_TOKEN ?? ''
  const res = await call('metaculus posts 100', 'https://www.metaculus.com/api/posts/?statuses=open&limit=100&order_by=-hotness&forecast_type=binary&with_cp=true', {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  })
  const json = JSON.parse(res.text) as { results?: Array<Record<string, unknown>> }
  const cats = new Map<string, number>()
  let withLatest = 0
  const samples: string[] = []
  for (const post of json.results ?? []) {
    const projects = post.projects as { category?: Array<{ slug: string }> } | undefined
    for (const cat of projects?.category ?? []) cats.set(cat.slug, (cats.get(cat.slug) ?? 0) + 1)
    const question = post.question as { aggregations?: Record<string, { latest?: { centers?: number[]; forecast_values?: number[] } | null }> } | undefined
    const latest = question?.aggregations?.recency_weighted?.latest
    if (latest) {
      withLatest += 1
      if (samples.length < 3) samples.push(JSON.stringify({ title: post.title, centers: latest.centers, keys: Object.keys(latest) }))
    }
  }
  console.log(`results=${json.results?.length} with_latest=${withLatest}`)
  console.log(`categories=${[...cats].sort((a, b) => b[1] - a[1]).map(([slug, n]) => `${slug}:${n}`).join(', ')}`)
  for (const sample of samples) console.log(head(sample, 400))
  const geo = await call('metaculus categories=geopolitics', 'https://www.metaculus.com/api/posts/?statuses=open&limit=3&forecast_type=binary&with_cp=true&categories=geopolitics', {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  })
  const geoJson = JSON.parse(geo.text) as { results?: Array<{ title: string }> }
  console.log(`geopolitics titles=${(geoJson.results ?? []).map((item) => item.title).join(' | ')}`)
}

async function bearer3(): Promise<void> {
  const token = process.env.EARTHDATA_PASSWORD ?? ''
  console.log(`token dots=${(token.match(/\./g) ?? []).length} starts_eyJ=${token.startsWith('eyJ')}`)
  const auth = { Authorization: `Bearer ${token}` }
  const cmr = await call(
    'cmr GPM_3IMERGDL',
    'https://cmr.earthdata.nasa.gov/search/granules.json?short_name=GPM_3IMERGDL&sort_key=-start_date&page_size=2',
  )
  const cmrE = await call(
    'cmr GPM_3IMERGDE',
    'https://cmr.earthdata.nasa.gov/search/granules.json?short_name=GPM_3IMERGDE&sort_key=-start_date&page_size=2',
  )
  let dap: string | null = null
  for (const res of [cmr, cmrE]) {
    try {
      const json = JSON.parse(res.text) as { feed?: { entry?: Array<{ title?: string; time_start?: string; links?: Array<{ href: string; rel: string }> }> } }
      for (const entry of json.feed?.entry ?? []) {
        console.log(`granule ${entry.title} start=${entry.time_start}`)
        for (const link of entry.links ?? []) if (/opendap|\.nc4/i.test(link.href)) console.log(`  ${link.rel.split('/').pop()} ${link.href}`)
        dap = dap ?? entry.links?.find((link) => /opendap/i.test(link.href) && /\.nc4/.test(link.href))?.href ?? null
      }
    } catch {
      console.log(head(res.text, 300))
    }
  }
  if (dap) {
    const base = dap.replace(/\.html$/, '')
    const lon = Math.round((81.06 + 179.95) / 0.1)
    const lat = Math.round((6.99 + 89.95) / 0.1)
    const ascii = await call('gesdisc opendap ascii', `${base}.ascii?precipitation[0:0][${lon}:${lon}][${lat}:${lat}]`, { headers: auth })
    console.log(head(ascii.text, 500))
    const dds = await call('gesdisc opendap dds', `${base}.dds`, { headers: auth })
    console.log(head(dds.text, 600))
  }
  const bm = 'https://ladsweb.modaps.eosdis.nasa.gov/opendap/RemoteResources/laads/allData/5200/VNP46A2/2026/273/VNP46A2.A2026273.h26v08.002.2026281153759.h5'
  const dmr = await call('laads opendap dds', `${bm}.dds`, { headers: auth })
  console.log(head(dmr.text, 900))
  const archiveHead = await fetch('https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A2/2026/273/VNP46A2.A2026273.h26v08.002.2026281153759.h5', {
    method: 'HEAD',
    headers: auth,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  console.log(`[laads archive HEAD] ${archiveHead ? `${archiveHead.status} type=${archiveHead.headers.get('content-type')} length=${archiveHead.headers.get('content-length')}` : 'fetch error'}`)
}

async function metaculus3(): Promise<void> {
  const token = process.env.METACULUS_TOKEN ?? ''
  const res = await call('metaculus post 43885', 'https://www.metaculus.com/api/posts/43885/?with_cp=true', {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  })
  const post = JSON.parse(res.text) as { question?: Record<string, unknown>; nr_forecasters?: number }
  const question = post.question ?? {}
  console.log(`nr_forecasters=${post.nr_forecasters} default_aggregation_method=${String(question.default_aggregation_method)} cp_reveal_time=${String(question.cp_reveal_time)}`)
  const aggs = (question.aggregations ?? {}) as Record<string, { latest?: unknown }>
  for (const [key, value] of Object.entries(aggs)) console.log(`agg ${key} latest=${head(value?.latest ?? null, 300)}`)
}

async function probe4(): Promise<void> {
  const token = process.env.EARTHDATA_PASSWORD ?? ''
  const auth = { Authorization: `Bearer ${token}` }
  const lon = Math.round((81.06 + 179.95) / 0.1)
  const lat = Math.round((6.99 + 89.95) / 0.1)
  const granule = 'https://opendap.earthdata.nasa.gov/collections/C2723754859-GES_DISC/granules/GPM_3IMERGDL.07%3A3B-DAY-L.MS.MRG.3IMERG.20261007-S000000-E235959.V07C.nc4'
  const ce = encodeURIComponent(`/precipitation[0][${lon}][${lat}];/precipitation[0][${lon - 1}:${lon + 1}][${lat - 1}:${lat + 1}]`)
  const csv = await call('cloud opendap dap.csv', `${granule}.dap.csv?dap4.ce=${ce}`, { headers: auth })
  console.log(head(csv.text, 600))
  const ascii = await call('cloud opendap dap2 ascii', `${granule}.ascii?${encodeURIComponent(`precipitation[0:0][${lon}:${lon}][${lat}:${lat}]`)}`, { headers: auth })
  console.log(head(ascii.text, 400))
  const bm = await call(
    'cloud opendap VNP46A2 dmr',
    'https://opendap.earthdata.nasa.gov/collections/C3365931269-LAADS/granules/VNP46A2.A2026273.h26v08.002.2026281153759.dmr',
    { headers: auth },
  )
  console.log(head(bm.text, 500))
  const laadsDap = await call(
    'laads opendap dmr no-redirect',
    'https://ladsweb.modaps.eosdis.nasa.gov/opendap/RemoteResources/laads/allData/5200/VNP46A2/2026/273/VNP46A2.A2026273.h26v08.002.2026281153759.h5.dmr.xml',
    { headers: auth, redirect: 'manual' },
  )
  console.log(`laads opendap location host=${laadsDap.status}`)
  const metaToken = process.env.METACULUS_TOKEN ?? ''
  const me = await call('metaculus users/me', 'https://www.metaculus.com/api/users/me/', {
    headers: { Authorization: `Token ${metaToken}`, Accept: 'application/json' },
  })
  try {
    const json = JSON.parse(me.text) as Record<string, unknown>
    console.log(`me keys=${Object.keys(json).join(',')} is_bot=${String(json.is_bot)}`)
    for (const [key, value] of Object.entries(json)) if (/hide|cp|community|api_/i.test(key)) console.log(`me ${key}=${JSON.stringify(value)}`)
  } catch {
    console.log(head(me.text, 200))
  }
}

async function reliefweb2(): Promise<void> {
  const app = encodeURIComponent(process.env.RELIEFWEB_APPNAME ?? '')
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const bodies: Array<[string, string, unknown]> = [
    ['reports full', 'reports', { limit: 1000, offset: 0, sort: ['date.created:desc'], fields: { include: ['title'] }, filter: { field: 'date.created', value: { from: since } } }],
    ['reports no-sort', 'reports', { limit: 5, fields: { include: ['title'] }, filter: { field: 'date.created', value: { from: since } } }],
    ['reports from-no-ms', 'reports', { limit: 5, fields: { include: ['title'] }, filter: { field: 'date.created', value: { from: since.replace(/\.\d{3}Z$/, '+00:00') } } }],
    ['disasters changed', 'disasters', { limit: 5, sort: ['date.changed:desc'], fields: { include: ['name', 'date.changed'] }, filter: { field: 'date.changed', value: { from: since } } }],
  ]
  for (const [label, path, body] of bodies) {
    const res = await call(`reliefweb ${label}`, `https://api.reliefweb.int/v2/${path}?appname=${app}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    console.log(head(res.text, 400))
  }
}

async function main(): Promise<void> {
  if (want('reliefweb2')) await reliefweb2()
  if (want('probe4')) await probe4()
  if (want('bearer3')) await bearer3()
  if (want('metaculus3')) await metaculus3()
  if (want('earthdata2')) await earthdata2()
  if (want('acled2')) await acled2()
  if (want('metaculus2')) await metaculus2()
  if (want('reliefweb')) await reliefweb()
  if (want('metaculus')) await metaculus()
  if (want('cloudflare')) await cloudflare()
  if (want('eia')) await eia()
  if (want('imerg')) await imerg()
  if (want('blackmarble')) await blackMarble()
  if (want('acled')) await acled()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? redactSecrets(error.message) : error)
  process.exit(1)
})
