/**
 * Lightweight Jeju day-course assembler — SELF-CONTAINED in mcp-server/.
 *
 * Does NOT call /api/jeju/tourist-course and does NOT import the web app's
 * tourist-course engine. Builds a simple 4–6 stop "추천 하루 코스" from:
 *   1. Fast upstream pools (featured + seasonal), fetched in parallel with a
 *      short timeout budget (~8s), plus
 *   2. A curated fallback of well-known real Jeju places, so we always return
 *      a usable course even if upstreams are cold/slow.
 *
 * Goal: finish in one tool call within ~10s for Kakao PlayMCP review.
 */

import { postJson } from './http.js';

export type CourseLocale = 'ko' | 'en' | 'ja' | 'zh-TW' | 'zh-CN';

export interface CoursePlace {
  name: string;
  area: string;
  note: string;
  /** Optional category hint for slot preference (food / cafe / sight). */
  kind?: 'sight' | 'food' | 'cafe' | 'nature' | 'culture' | 'other';
}

export interface CourseStop {
  slot: string;
  name: string;
  area: string;
  note: string;
}

export interface LightweightCourse {
  title: string;
  duration: '반나절' | '하루';
  areaFocus: string | null;
  stops: CourseStop[];
  disclaimer: string;
}

export interface PlanCourseInput {
  duration?: '반나절' | '하루';
  area?: string;
  query?: string;
  locale?: CourseLocale;
  companion?: string;
  ageGroup?: string;
  groupSize?: number;
}

/** Hard budget for ALL upstream fetches combined (ms). Leave headroom under 10s. */
const FETCH_BUDGET_MS = 5_000;

/**
 * Curated real Jeju places — used when upstream pools are empty/slow.
 * Names and areas are well-known public landmarks (not invented).
 */
const FALLBACK_POOL: readonly CoursePlace[] = [
  { name: '동문재래시장', area: '제주시', note: '제주 대표 재래시장 — 먹거리·기념품', kind: 'food' },
  { name: '용두암', area: '제주시', note: '제주시 해안 랜드마크 — 짧은 산책', kind: 'sight' },
  { name: '제주올레시장', area: '서귀포시', note: '서귀포 중심 먹거리·야시장 분위기', kind: 'food' },
  { name: '천지연폭포', area: '서귀포시', note: '서귀포 대표 폭포 — 산책로 완만', kind: 'nature' },
  { name: '정방폭포', area: '서귀포시', note: '바다로 떨어지는 폭포 — 사진 명소', kind: 'nature' },
  { name: '성산일출봉', area: '성산·동부', note: '유네스코 세계자연유산 — 정상 전망', kind: 'nature' },
  { name: '섭지코지', area: '성산·동부', note: '해안 절경 산책 — 등대·해안길', kind: 'sight' },
  { name: '우도', area: '성산·동부', note: '성산항에서 배편 — 반나절 섬 여행', kind: 'sight' },
  { name: '한림공원', area: '한림·서부', note: '협재·한림 인근 정원·동굴 코스', kind: 'sight' },
  { name: '협재해수욕장', area: '한림·서부', note: '에메랄드빛 해변 — 휴식·사진', kind: 'nature' },
  { name: '애월 해안도로', area: '애월·서부', note: '카페·드라이브 코스 — 노을 명소', kind: 'cafe' },
  { name: '한라산 영실코스', area: '중문·한라산', note: '완만한 트레킹 — 날씨·예약 확인', kind: 'nature' },
  { name: '주상절리대', area: '중문', note: '중문 해안 주상절리 — 짧은 관람', kind: 'sight' },
  { name: '색달해변(중문색달)', area: '중문', note: '중문 관광단지 해변 — 산책', kind: 'nature' },
  { name: '카멜리아힐', area: '중문·안덕', note: '동백·수국 정원 — 계절 명소', kind: 'sight' },
  { name: '오설록 티뮤지엄', area: '안덕·서부', note: '녹차밭·티룸 — 실내·야외 겸용', kind: 'culture' },
  { name: '비자림', area: '구좌·동부', note: '비자나무 숲길 — 그늘 산책', kind: 'nature' },
  { name: '월정리 해변', area: '구좌·동부', note: '카페거리·해변 산책', kind: 'cafe' },
  { name: '함덕해수욕장', area: '조천·동부', note: '에메랄드 해변 — 가족 친화', kind: 'nature' },
  { name: '사려니숲길', area: '조천·중산간', note: '숲길 트레킹 — 예약·구간 확인', kind: 'nature' },
];

const FULL_DAY_SLOTS = ['오전', '점심', '오후', '늦은 오후', '저녁'] as const;
const HALF_DAY_SLOTS = ['오전', '점심', '오후', '늦은 오후'] as const;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function oneLine(s: string, max = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function inferKind(categoryLabel: string, tags: string, title: string): CoursePlace['kind'] {
  const hay = `${categoryLabel} ${tags} ${title}`.toLowerCase();
  if (/카페|cafe|커피|티룸|tea/.test(hay)) return 'cafe';
  if (/음식|맛집|식당|restaurant|food|시장|해산물|고기/.test(hay)) return 'food';
  if (/박물관|미술관|전시|뮤지엄|museum|gallery|문화/.test(hay)) return 'culture';
  if (/오름|폭포|숲|해변|해수욕|트레킹|올레|한라|자연|공원/.test(hay)) return 'nature';
  if (/관광|명소|전망|포토|랜드마크/.test(hay)) return 'sight';
  return 'other';
}

/** Normalize a featured/seasonal list item into CoursePlace. */
function normalizePlace(raw: unknown): CoursePlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.title) || str(o.name);
  if (!name) return null;
  const area =
    str(o.region) ||
    str(o.area) ||
    str(o.venue) ||
    '';
  const note =
    oneLine(
      str(o.introduction) ||
        str(o.description) ||
        str(o.charm) ||
        str(o.season_hint) ||
        str(o.oneLineSummary) ||
        str(o.categoryLabel) ||
        '제주 추천 명소',
    ) || '제주 추천 명소';
  const tags = Array.isArray(o.tags) ? o.tags.map(str).join(' ') : str(o.rawTags);
  const kind = inferKind(str(o.categoryLabel), tags, name);
  return { name, area, note, kind };
}

function uniqueByName(places: CoursePlace[]): CoursePlace[] {
  const seen = new Set<string>();
  const out: CoursePlace[] = [];
  for (const p of places) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Simple keyword score for area / query / companion preferences. */
function scorePlace(p: CoursePlace, area: string, query: string, prefs: string): number {
  const hay = `${p.name} ${p.area} ${p.note} ${p.kind ?? ''}`.toLowerCase();
  let score = 0;
  if (area) {
    const a = area.toLowerCase();
    if (hay.includes(a)) score += 5;
    // Common aliases
    if (a.includes('서귀') && /서귀|중문|안덕/.test(hay)) score += 3;
    if (a.includes('성산') && /성산|섭지|우도|동부/.test(hay)) score += 3;
    if (a.includes('애월') && /애월|한림|협재|서부/.test(hay)) score += 3;
    if ((a.includes('제주') || a.includes('시내')) && /제주시|동문|용두/.test(hay)) score += 2;
  }
  if (query) {
    for (const tok of query.toLowerCase().split(/[\s,./|]+/).filter((t) => t.length >= 2)) {
      if (hay.includes(tok)) score += 2;
    }
    if (/카페|cafe/.test(query) && p.kind === 'cafe') score += 3;
    if (/맛집|음식|먹거리|food/.test(query) && p.kind === 'food') score += 3;
    if (/자연|오름|트레킹|올레|폭포|해변/.test(query) && p.kind === 'nature') score += 3;
    if (/박물관|미술관|실내|아이|kids|family|가족/.test(query) && (p.kind === 'culture' || p.kind === 'sight'))
      score += 2;
  }
  if (prefs) {
    if (/부모|시니어|60|어르/.test(prefs) && (p.kind === 'culture' || p.kind === 'sight')) score += 1;
    if (/아이|어린|가족|kids/.test(prefs) && (p.kind === 'sight' || p.kind === 'nature')) score += 1;
  }
  return score;
}

function pickForSlot(
  pool: CoursePlace[],
  used: Set<string>,
  prefer: CoursePlace['kind'][],
): CoursePlace | null {
  for (const kind of prefer) {
    const hit = pool.find((p) => !used.has(p.name) && p.kind === kind);
    if (hit) return hit;
  }
  return pool.find((p) => !used.has(p.name)) ?? null;
}

/**
 * Assemble an ordered day course from a scored pool.
 * Half-day → 4 stops; full-day → 5 stops.
 */
function assembleStops(pool: CoursePlace[], duration: '반나절' | '하루'): CourseStop[] {
  const slots = duration === '반나절' ? HALF_DAY_SLOTS : FULL_DAY_SLOTS;
  const used = new Set<string>();
  const stops: CourseStop[] = [];

  const slotPrefs: Record<string, CoursePlace['kind'][]> = {
    오전: ['nature', 'sight', 'culture', 'other'],
    점심: ['food', 'cafe', 'other'],
    오후: ['sight', 'nature', 'culture', 'other'],
    '늦은 오후': ['cafe', 'sight', 'nature', 'other'],
    저녁: ['food', 'cafe', 'sight', 'other'],
  };

  for (const slot of slots) {
    const pick = pickForSlot(pool, used, slotPrefs[slot] ?? ['other']);
    if (!pick) break;
    used.add(pick.name);
    stops.push({
      slot,
      name: pick.name,
      area: pick.area || '제주',
      note: pick.note,
    });
  }
  return stops;
}

async function fetchPoolWithBudget(locale: CourseLocale, query?: string): Promise<CoursePlace[]> {
  const opts = { timeoutMs: FETCH_BUDGET_MS };

  const tasks: Promise<CoursePlace[]>[] = [
    postJson<{ ok?: boolean; places?: unknown[] }>(
      '/api/jeju/tourist-featured',
      { locale },
      opts,
    ).then((res) => {
      if (!res.ok || !res.data || res.data.ok === false) return [];
      return (res.data.places ?? []).map(normalizePlace).filter((p): p is CoursePlace => !!p);
    }),
    postJson<{ ok?: boolean; sights?: unknown[] }>(
      '/api/jeju/tourist-seasonal',
      { locale },
      opts,
    ).then((res) => {
      if (!res.ok || !res.data || res.data.ok === false) return [];
      return (res.data.sights ?? []).map(normalizePlace).filter((p): p is CoursePlace => !!p);
    }),
  ];

  if (query && query.trim().length >= 2) {
    tasks.push(
      postJson<{ ok?: boolean; gems?: unknown[] }>(
        '/api/jeju/tourist-local',
        { query: query.trim().slice(0, 200), locale },
        opts,
      ).then((res) => {
        if (!res.ok || !res.data || res.data.ok === false) return [];
        return (res.data.gems ?? []).map(normalizePlace).filter((p): p is CoursePlace => !!p);
      }),
    );
  }

  const settled = await Promise.allSettled(tasks);
  const places: CoursePlace[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') places.push(...r.value);
  }
  return uniqueByName(places);
}

function disclaimer(locale: CourseLocale): string {
  switch (locale) {
    case 'en':
      return 'Lightweight quick course (not the full AI planner). Opening hours & traffic may vary — confirm before you go.';
    case 'ja':
      return '軽量の簡易コースです（本格AIプランナーではありません）。営業時間・交通は変動するので事前にご確認ください。';
    case 'zh-TW':
      return '此為輕量快速路線（非完整 AI 規劃）。營業時間與交通可能變動，出發前請再確認。';
    case 'zh-CN':
      return '此为轻量快速路线（非完整 AI 规划）。营业时间与交通可能变动，出发前请再确认。';
    case 'ko':
    default:
      return '가벼운 추천 하루 코스입니다(웹의 풀 AI 코스 엔진과 다름). 영업·교통은 변동될 수 있으니 방문 전 확인해 주세요.';
  }
}

function titleFor(duration: '반나절' | '하루', area: string | null, locale: CourseLocale): string {
  const areaBit = area ? ` · ${area}` : '';
  switch (locale) {
    case 'en':
      return duration === '반나절'
        ? `Jeju half-day course${areaBit}`
        : `Jeju one-day course${areaBit}`;
    case 'ja':
      return duration === '반나절' ? `済州 半日コース${areaBit}` : `済州 一日コース${areaBit}`;
    case 'zh-TW':
      return duration === '반나절' ? `濟州半日路線${areaBit}` : `濟州一日路線${areaBit}`;
    case 'zh-CN':
      return duration === '반나절' ? `济州半日路线${areaBit}` : `济州一日路线${areaBit}`;
    case 'ko':
    default:
      return duration === '반나절' ? `제주 반나절 추천 코스${areaBit}` : `제주 하루 추천 코스${areaBit}`;
  }
}

/**
 * Build a lightweight day course. Always resolves (never throws). Target ≤10s.
 */
export async function planLightweightCourse(
  input: PlanCourseInput,
): Promise<{ ok: true; course: LightweightCourse } | { ok: false; error: string }> {
  try {
    const locale: CourseLocale = input.locale ?? 'ko';
    const duration: '반나절' | '하루' = input.duration === '반나절' ? '반나절' : '하루';
    const area = str(input.area) || null;
    const query = str(input.query);
    const prefs = [str(input.companion), str(input.ageGroup)].filter(Boolean).join(' ');

    const live = await fetchPoolWithBudget(locale, query || undefined);
    const pool = uniqueByName([...live, ...FALLBACK_POOL]);

    // Score & sort: higher score first; mild shuffle among ties via name hash for variety.
    const scored = pool
      .map((p) => ({
        p,
        s: scorePlace(p, area ?? '', query, prefs),
      }))
      .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name));

    // When an area was requested, prefer places that actually matched it
    // (score contribution ≥3 from area aliases) before zero-score fillers.
    let ranked = scored.map((x) => x.p);
    if (area) {
      const focused = scored.filter((x) => x.s >= 3).map((x) => x.p);
      const rest = scored.filter((x) => x.s < 3).map((x) => x.p);
      ranked = focused.length >= 3 ? [...focused, ...rest] : ranked;
    }

    const stops = assembleStops(ranked, duration);
    if (stops.length < 3) {
      return { ok: false, error: '추천 코스를 구성할 명소가 부족합니다. 잠시 후 다시 시도해 주세요.' };
    }

    return {
      ok: true,
      course: {
        title: titleFor(duration, area, locale),
        duration,
        areaFocus: area,
        stops,
        disclaimer: disclaimer(locale),
      },
    };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : '코스 생성 중 오류가 발생했습니다.',
    };
  }
}

/** Format a course into clean Korean (or locale) text for MCP tool content. */
export function formatCourseText(course: LightweightCourse): string {
  const lines: string[] = [
    `🗺 ${course.title}`,
    `소요: ${course.duration}${course.areaFocus ? ` · 지역 포커스: ${course.areaFocus}` : ''}`,
    '',
  ];
  for (const s of course.stops) {
    lines.push(`• [${s.slot}] ${s.name} (${s.area})`);
    lines.push(`  ${s.note}`);
  }
  lines.push('');
  lines.push(`※ ${course.disclaimer}`);
  return lines.join('\n');
}
