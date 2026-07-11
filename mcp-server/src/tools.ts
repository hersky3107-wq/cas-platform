/**
 * Tool registry for the Jeju MCP server.
 *
 * Most tools are THIN PROXIES over existing deployed Next.js API routes
 * (server-to-server, no auth). plan_jeju_course is an exception: it assembles a
 * lightweight day-course INSIDE this server (featured/seasonal pools + curated
 * fallback) and deliberately does NOT call /api/jeju/tourist-course (too slow
 * for Kakao PlayMCP). No LLM runs here.
 *
 * Robustness contract for every tool:
 *   - Zod-validate inputs (the SDK enforces the shape; we also normalize).
 *   - Wrap all I/O; never throw. Return a clear message as tool content.
 *   - Upstream routes often reply HTTP 200 with { ok: false } — we inspect the
 *     BODY, not just the status.
 *
 * Tool descriptions are in ENGLISH (the calling LLM reads them to route intent)
 * with Korean usage notes where helpful, since end users are Korean.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getJson, postJson } from './http.js';
import { APP_BASE_URL } from './config.js';
import { getJejuWeather } from './weather.js';
import { formatCourseText, planLightweightCourse } from './course.js';

type AiLocale = 'ko' | 'en' | 'ja' | 'zh-TW' | 'zh-CN';

/** Max items we include from a list before capping (we report the true total). */
const LIST_CAP = 10;

// ── MCP content helpers ─────────────────────────────────────────────────────

/**
 * Localized "go to the full web app" footer. This turns each tool response into
 * a teaser that funnels the user to the full service (full list, map, richer
 * detail). One clean line, appended once at the very end of every success reply.
 */
function webLink(locale: AiLocale): string {
  const url = `${APP_BASE_URL}/jeju/tourist`;
  switch (locale) {
    case 'en':
      return `👉 Full list & map in the Jeju AI Travel Guide: ${url}`;
    case 'ja':
      return `👉 全リスト・地図は済州AI旅行ガイドで: ${url}`;
    case 'zh-TW':
      return `👉 完整清單與地圖請見濟州 AI 旅遊指南：${url}`;
    case 'zh-CN':
      return `👉 完整列表与地图请见济州 AI 旅游指南：${url}`;
    case 'ko':
    default:
      return `👉 전체 목록·지도는 제주 AI 여행 안내: ${url}`;
  }
}

/**
 * Footer specifically for the lightweight course tool — points users to the
 * full AI-personalized course planner on the web (which we deliberately do NOT
 * call from MCP, to stay under Kakao's timeout).
 */
function courseWebFooter(locale: AiLocale): string {
  const url = `${APP_BASE_URL}/jeju/tourist`;
  switch (locale) {
    case 'en':
      return `👉 Full AI-personalized courses: ${url}`;
    case 'ja':
      return `👉 本格AIパーソナライズコースはこちら: ${url}`;
    case 'zh-TW':
      return `👉 完整 AI 個人化路線請見：${url}`;
    case 'zh-CN':
      return `👉 完整 AI 个性化路线请见：${url}`;
    case 'ko':
    default:
      return `👉 풀 AI 맞춤 코스는 웹에서: ${url}`;
  }
}

/** Localized "showing N of M" note — an explicit count instead of a vague cutoff. */
function countNote(total: number, shown: number, locale: AiLocale): string {
  const capped = shown < total;
  switch (locale) {
    case 'en':
      return capped ? `Showing ${shown} of ${total}.` : `${total} result${total === 1 ? '' : 's'}.`;
    case 'ja':
      return capped ? `全${total}件中${shown}件を表示します。` : `全${total}件。`;
    case 'zh-TW':
      return capped ? `共 ${total} 筆，顯示 ${shown} 筆。` : `共 ${total} 筆。`;
    case 'zh-CN':
      return capped ? `共 ${total} 条，显示 ${shown} 条。` : `共 ${total} 条。`;
    case 'ko':
    default:
      return capped ? `총 ${total}곳 중 ${shown}곳을 보여드려요.` : `총 ${total}곳입니다.`;
  }
}

/**
 * Success content: an optional summary line + the raw JSON payload + a localized
 * web-app link. The link is always appended so every tool acts as a teaser.
 */
function ok(payload: unknown, summary?: string, locale: AiLocale = 'ko'): CallToolResult {
  const parts: string[] = [];
  if (summary) parts.push(summary);
  parts.push(JSON.stringify(payload, null, 2));
  parts.push(webLink(locale));
  return { content: [{ type: 'text', text: parts.join('\n\n') }] };
}

// ── List-item formatting helpers ─────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** First non-empty string among the given keys. */
function firstStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const s = str(obj[k]);
    if (s) return s;
  }
  return '';
}

/** A link is "ours" (the homepage funnel) — never repeat it per item. */
function isHomepageLink(url: string): boolean {
  return url.includes('/jeju/tourist') || url === APP_BASE_URL || url.startsWith(`${APP_BASE_URL}/jeju`);
}

/** Collapse whitespace and trim to a single clean line. */
function oneLine(s: string, max = 140): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Format ONE list item into clean, consistent lines:
 *   "N. {name} ({area})"
 *   "   {one-line description}"
 *   "   {facts · joined}"          (distance/duration/route/date-range, when present)
 *   "   🔗 {label} {url}"          (ONLY genuine external links — official trail /
 *                                    ferry booking — never our homepage)
 * No per-item homepage link, no dangling markdown, no doubled links.
 */
function formatItem(raw: unknown, index: number): string {
  if (!raw || typeof raw !== 'object') return `${index + 1}. ${String(raw)}`;
  const o = raw as Record<string, unknown>;

  const courseNo = str(o.courseNo);
  const base = firstStr(o, ['name', 'title']);
  const name = [courseNo, base].filter(Boolean).join(' ') || '(정보 없음)';
  const area = firstStr(o, ['area', 'region', 'venue', 'departurePoint']);
  const desc = firstStr(o, [
    'description',
    'introduction',
    'intro',
    'charm',
    'season_hint',
    'oneLineSummary',
  ]);

  // Facts that carry no language-specific label (safe across locales).
  const facts: string[] = [];
  for (const k of ['distance', 'duration', 'startEnd']) {
    const v = str(o[k]);
    if (v) facts.push(v);
  }
  const sd = str(o.startDate);
  const ed = str(o.endDate);
  if (sd || ed) facts.push([sd, ed].filter(Boolean).join(' ~ '));

  // Keep genuinely useful EXTERNAL links (not our homepage).
  const links: string[] = [];
  const official = str(o.officialUrl);
  if (official && !isHomepageLink(official)) links.push(official);
  const ferryInfo = o.ferryInfo as { links?: unknown } | null | undefined;
  if (ferryInfo && typeof ferryInfo === 'object' && Array.isArray(ferryInfo.links)) {
    for (const l of ferryInfo.links) {
      if (!l || typeof l !== 'object') continue;
      const url = str((l as Record<string, unknown>).url);
      const label = str((l as Record<string, unknown>).label);
      if (url && !isHomepageLink(url)) links.push(label ? `${label} ${url}` : url);
    }
  }

  const lines: string[] = [`${index + 1}. ${name}${area ? ` (${area})` : ''}`];
  if (desc) lines.push(`   ${oneLine(desc)}`);
  if (facts.length) lines.push(`   ${facts.join(' · ')}`);
  for (const link of links) lines.push(`   🔗 ${link}`);
  return lines.join('\n');
}

/**
 * Success content for LIST-returning tools. Formats items into clean text
 * (name / area / one-line description + genuine external links), includes all
 * items up to LIST_CAP, reports the TRUE total ("총 15곳 중 10곳"), and appends
 * exactly ONE localized web footer at the end. No raw JSON, no per-item homepage
 * link. Non-list payloads fall back to plain ok().
 */
function okList(
  data: unknown,
  listKeys: string[],
  headlineKo: string,
  locale: AiLocale = 'ko',
): CallToolResult {
  if (!data || typeof data !== 'object') return ok(data, headlineKo, locale);
  const obj = data as Record<string, unknown>;
  const key = listKeys.find((k) => Array.isArray(obj[k]));
  if (!key) return ok(data, headlineKo, locale);

  const list = obj[key] as unknown[];
  const total = list.length;
  const shown = Math.min(total, LIST_CAP);
  const items = list.slice(0, LIST_CAP);

  const blocks: string[] = [];
  // Headline (ko only, to avoid language mixing) + accurate count.
  const headline = locale === 'ko' ? headlineKo : '';
  const head = [headline, countNote(total, shown, locale)].filter(Boolean).join(' ');
  if (head) blocks.push(head);
  // Optional AI intro (e.g. tourist recommend) as a lead line.
  const intro = str(obj.intro);
  if (intro) blocks.push(oneLine(intro, 300));

  const body = items.map((it, i) => formatItem(it, i)).join('\n');
  blocks.push(body);
  blocks.push(webLink(locale));
  return { content: [{ type: 'text', text: blocks.join('\n\n') }] };
}

/** Error content: clearly flagged so the model can relay/retry gracefully. */
function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `ERROR: ${message}` }], isError: true };
}

// ── Shopping-item formatting (GET /api/tourist/shopping — no {ok} wrapper) ───

type ShoppingCategory = 'dutyfree' | 'market' | 'mall' | 'shop';

const SHOPPING_CATEGORY_LABEL: Record<AiLocale, Record<ShoppingCategory, string>> = {
  ko: { dutyfree: '면세점', market: '시장', mall: '쇼핑몰', shop: '상점' },
  en: { dutyfree: 'Duty-free', market: 'Market', mall: 'Mall', shop: 'Shop' },
  ja: { dutyfree: '免税店', market: '市場', mall: 'モール', shop: '店舗' },
  'zh-TW': { dutyfree: '免稅店', market: '市場', mall: '購物中心', shop: '商店' },
  'zh-CN': { dutyfree: '免税店', market: '市场', mall: '购物中心', shop: '商店' },
};

function isShoppingCategory(v: string): v is ShoppingCategory {
  return v === 'dutyfree' || v === 'market' || v === 'mall' || v === 'shop';
}

/**
 * Format ONE shopping item: "N. {name} [{localized category}]" + address +
 * note + phone/homepage (kept — these are genuinely useful contact links).
 */
function formatShoppingItem(raw: unknown, index: number, locale: AiLocale): string {
  if (!raw || typeof raw !== 'object') return `${index + 1}. ${String(raw)}`;
  const o = raw as Record<string, unknown>;

  const name = str(o.name) || '(정보 없음)';
  const categoryRaw = str(o.category);
  const labels = SHOPPING_CATEGORY_LABEL[locale] ?? SHOPPING_CATEGORY_LABEL.ko;
  const category = isShoppingCategory(categoryRaw) ? labels[categoryRaw] : categoryRaw;
  const sponsor = o.sponsor === true;
  const address = str(o.address);
  const note = str(o.note);
  const phone = str(o.phone);
  const homepage = str(o.homepage);

  const lines: string[] = [
    `${index + 1}. ${name}${category ? ` [${category}]` : ''}${sponsor ? ' ⭐' : ''}`,
  ];
  if (address) lines.push(`   ${address}`);
  if (note) lines.push(`   ${oneLine(note)}`);
  const contact: string[] = [];
  if (phone) contact.push(`☎ ${phone}`);
  if (homepage) contact.push(`🔗 ${homepage}`);
  if (contact.length) lines.push(`   ${contact.join(' · ')}`);
  return lines.join('\n');
}

/** Success content for the shopping list — same shape/footer contract as okList. */
function okShopping(items: unknown[], locale: AiLocale): CallToolResult {
  const total = items.length;
  const shown = Math.min(total, LIST_CAP);
  const capped = items.slice(0, LIST_CAP);

  const headline = locale === 'ko' ? '제주 쇼핑·시장 정보입니다.' : '';
  const head = [headline, countNote(total, shown, locale)].filter(Boolean).join(' ');
  const body = capped.map((it, i) => formatShoppingItem(it, i, locale)).join('\n');
  const text = [head, body, webLink(locale)].filter(Boolean).join('\n\n');
  return { content: [{ type: 'text', text }] };
}

const localeSchema = z
  .enum(['ko', 'en', 'ja', 'zh-TW', 'zh-CN'])
  .default('ko')
  .describe("Output language for AI-generated content. One of ko|en|ja|zh-TW|zh-CN. Default 'ko'.");

/**
 * Fixed query for the "비 와도 좋은 곳" (rainy-day) chip — copied verbatim from the
 * web app (app/jeju/tourist/search-panel.tsx RAINY_QUERY) so the MCP tool returns
 * the same indoor-focused results. Proxies POST /api/jeju/tourist.
 */
const RAINY_QUERY =
  '비 오는 날에도 좋은 제주의 제대로 된 실내 명소를 우선 추천: 미술관·박물관·전시관·뮤지엄·아쿠아리움·실내 테마공간 위주. 동네 소규모 공방·원데이클래스·게임장 같은 곳은 가급적 제외하고, 비 와도 충분히 즐길 만한 규모 있는 실내 명소 위주로.';

// Reusable body-check: many routes return { ok: false, error } with HTTP 200.
function bodyError(data: unknown): string | null {
  if (data && typeof data === 'object' && 'ok' in data && (data as { ok?: unknown }).ok === false) {
    const e = (data as { error?: unknown }).error;
    return typeof e === 'string' && e ? e : '요청이 실패했습니다 (ok:false).';
  }
  return null;
}

/** Service name every tool description must carry (Kakao PlayMCP review rule). */
const SERVICE_NAME = '제주 AI 여행 안내';

/**
 * Standard MCP tool annotations for our tools. Every tool is a READ-ONLY data
 * fetch that proxies a live external API, so: read-only, non-destructive,
 * idempotent, and open-world. `title` is a human-readable Korean label.
 */
function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {
  // 1. plan_jeju_course — lightweight in-MCP day course (NO web tourist-course). ─
  server.registerTool(
    'plan_jeju_course',
    {
      title: 'Plan a Jeju travel course',
      annotations: readOnlyAnnotations('제주 여행 코스 짜기'),
      description:
        `[${SERVICE_NAME}] ` +
        'Generate a lightweight Jeju (제주도) day itinerary / travel course with ' +
        '4–6 real stops (morning/lunch/afternoon/evening). Use for "plan my Jeju trip", ' +
        '"make a one-day Jeju course", "제주 여행 코스 짜줘". Returns in one call ' +
        '(~seconds). For a richer full AI-personalized multi-course plan, the web ' +
        'app at /jeju/tourist is linked in the response footer.',
      inputSchema: {
        mode: z
          .enum(['standard', 'custom'])
          .default('standard')
          .describe(
            "Accepted for compatibility. Both modes return one lightweight day-course; 'custom' uses companion/ageGroup/groupSize as soft preferences.",
          ),
        query: z
          .string()
          .max(500)
          .optional()
          .describe('Free-text interests or constraints, e.g. "cafes and ocean views", "아이와 함께".'),
        duration: z
          .enum(['반나절', '하루'])
          .optional()
          .describe("Trip length: '반나절' (half day, ~4 stops) or '하루' (full day, ~5 stops). Default '하루'."),
        area: z.string().max(100).optional().describe('Preferred Jeju area/region to focus on.'),
        companion: z
          .string()
          .max(100)
          .optional()
          .describe('Who is traveling, e.g. "부모님", "친구" (soft preference).'),
        ageGroup: z.string().max(100).optional().describe('Age group, e.g. "60대" (soft preference).'),
        groupSize: z.number().int().positive().max(100).optional().describe('Number of people (soft preference).'),
        locale: localeSchema,
      },
    },
    async (args): Promise<CallToolResult> => {
      const locale = args.locale ?? 'ko';
      const result = await planLightweightCourse({
        duration: args.duration,
        area: args.area,
        query: args.query,
        locale,
        companion: args.companion,
        ageGroup: args.ageGroup,
        groupSize: args.groupSize,
      });
      if (!result.ok) return fail(result.error);

      const text = [
        formatCourseText(result.course),
        '',
        courseWebFooter(locale),
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    },
  );

  // 2. find_hidden_spots — POST /api/jeju/tourist-local ─────────────────────────
  server.registerTool(
    'find_hidden_spots',
    {
      title: 'Find hidden local Jeju spots',
      annotations: readOnlyAnnotations('제주 숨은 로컬 명소 찾기'),
      description:
        `[${SERVICE_NAME}] ` +
        'Find lesser-known, local-favorite Jeju spots (hidden gems, "관광객은 잘 모르는" ' +
        'places, local restaurants/cafes/nature) matching a query. Use for ' +
        '"hidden gems in Jeju", "제주 로컬 맛집", "숨은 명소".',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe('What to look for, e.g. "quiet cafes", "제주 동쪽 숨은 바다".'),
        locale: localeSchema,
      },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/tourist-local', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return okList(res.data, ['gems'], '제주 숨은 로컬 명소를 찾았습니다.', args.locale);
    },
  );

  // 3. get_jeju_seasonal — POST /api/jeju/tourist-seasonal ──────────────────────
  server.registerTool(
    'get_jeju_seasonal',
    {
      title: 'Get seasonal Jeju highlights (right now)',
      annotations: readOnlyAnnotations('지금 제주 계절 명소'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get what is special in Jeju RIGHT NOW for the current season (seasonal ' +
        'sights, flowers, seasonal activities). Use for "지금 제주 가볼 만한 곳", ' +
        '"what\'s in season in Jeju now".',
      inputSchema: { locale: localeSchema },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/tourist-seasonal', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return okList(res.data, ['sights'], '지금 제주의 계절 명소입니다.', args.locale);
    },
  );

  // 4. get_jeju_festivals — POST /api/jeju/tourist-festivals ────────────────────
  server.registerTool(
    'get_jeju_festivals',
    {
      title: 'Get current Jeju festivals & events',
      annotations: readOnlyAnnotations('제주 축제·행사 조회'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get festivals and events happening in Jeju now / soon. Use for ' +
        '"제주 축제", "events in Jeju this month".',
      inputSchema: { locale: localeSchema },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/tourist-festivals', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      // Response is a union: { type:'sonar', events[] } | { type:'fallback', festivals[] }.
      return okList(res.data, ['events', 'festivals'], '제주의 축제·행사 정보입니다.', args.locale);
    },
  );

  // 5. get_jeju_trending — POST /api/jeju/tourist-featured ──────────────────────
  server.registerTool(
    'get_jeju_trending',
    {
      title: 'Get trending / featured Jeju places',
      annotations: readOnlyAnnotations('지금 뜨는 제주 명소'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get a curated set of currently trending / featured Jeju places ("지금 뜨는 ' +
        '제주"). Good default when the user wants popular recommendations without ' +
        'a specific query.',
      inputSchema: { locale: localeSchema },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/tourist-featured', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return okList(res.data, ['places'], '지금 뜨는 제주 명소입니다.', args.locale);
    },
  );

  // 5b. get_rainy_day_spots — POST /api/jeju/tourist (fixed rainy query) ────────
  server.registerTool(
    'get_rainy_day_spots',
    {
      title: 'Get rainy-day / indoor Jeju spots',
      annotations: readOnlyAnnotations('비 오는 날 제주 실내 명소'),
      description:
        `[${SERVICE_NAME}] ` +
        'Recommend Jeju places that are good even in bad weather — indoor ' +
        'attractions like museums, art galleries, aquariums, and indoor themed ' +
        'spaces. Use for "비 오는 날 갈 곳", "날씨 궂어도 좋은 곳", "실내 관광지", ' +
        '"rainy day in Jeju", "indoor things to do in Jeju".',
      inputSchema: { locale: localeSchema },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/tourist', { query: RAINY_QUERY, locale: args.locale });
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return okList(res.data, ['recommendations'], '비 와도 좋은 제주 실내 명소입니다.', args.locale);
    },
  );

  // 5c. get_jeju_islands — POST /api/jeju/tourist-ferry ─────────────────────────
  server.registerTool(
    'get_jeju_islands',
    {
      title: 'Get Jeju ferry island day-trips',
      annotations: readOnlyAnnotations('제주 섬 여행(배편)'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get info on Jeju\'s ferry-accessible islands for day trips ' +
        '(우도/가파도/마라도/추자도/비양도): charm, departure point, terminal, ferry ' +
        'duration, and booking notes. Use for "제주 섬 여행", "우도 어떻게 가", ' +
        '"island trip from Jeju".',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      // Route takes no body; POST with an empty object.
      const res = await postJson('/api/jeju/tourist-ferry', {});
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return okList(res.data, ['islands'], '제주 섬 여행(배편) 정보입니다.');
    },
  );

  // 5d. get_olle_trails — GET /api/jeju/tourist-olle ────────────────────────────
  server.registerTool(
    'get_olle_trails',
    {
      title: 'Get Jeju Olle trail courses',
      annotations: readOnlyAnnotations('제주 올레길 코스'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get the list of Jeju Olle (올레길) walking trail courses with distance, ' +
        'estimated duration, start/end points, and official links. Use for ' +
        '"올레길", "제주 걷기 코스", "Jeju Olle trail".',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      const res = await getJson('/api/jeju/tourist-olle');
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return okList(res.data, ['courses'], '제주 올레길 코스 목록입니다.');
    },
  );

  // 5e. get_oreum_hallasan — GET /api/jeju/tourist-oreum ────────────────────────
  server.registerTool(
    'get_oreum_hallasan',
    {
      title: 'Get Jeju oreum (volcanic cones) & Hallasan',
      annotations: readOnlyAnnotations('제주 오름·한라산 트레킹'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get a rotating selection of Jeju oreum (오름, volcanic cones) with ' +
        'location and description — good for hiking and Hallasan-area trails. ' +
        'Use for "오름", "한라산 둘레길", "제주 등산/트레킹", "oreum to hike".',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      const res = await getJson('/api/jeju/tourist-oreum');
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return okList(res.data, ['oreum'], '제주 오름·한라산 트레킹 정보입니다.');
    },
  );

  // 5f. get_jeju_shopping — TEMPORARILY DISABLED ────────────────────────────────
  // The API (/api/tourist/shopping) works fine (confirmed in browser), but the
  // deployed Kakao environment fails on this tool's MCP-side response handling.
  // Commented out (not deleted) so it can be fixed and re-registered after
  // passing review. Do NOT re-enable without re-verifying against Kakao.
  //
  // server.registerTool(
  //   'get_jeju_shopping',
  //   {
  //     title: 'Get Jeju shopping & markets',
  //     annotations: readOnlyAnnotations('제주 쇼핑·시장 안내'),
  //     description:
  //       `[${SERVICE_NAME}] ` +
  //       'Get Jeju shopping and markets — duty-free shops, traditional markets ' +
  //       '(오일장/동문시장), malls, and local shops. Useful for both foreign and ' +
  //       'domestic visitors. Use for "제주 쇼핑", "제주 면세점", "제주 전통시장", ' +
  //       '"제주 오일장", "where to shop in Jeju", "Jeju duty free".',
  //     inputSchema: { locale: localeSchema },
  //   },
  //   async (args): Promise<CallToolResult> => {
  //     const locale = args.locale ?? 'ko';
  //     const res = await getJson<{ items?: unknown[] }>(
  //       `/api/tourist/shopping?locale=${encodeURIComponent(locale)}`,
  //     );
  //     if (!res.ok) return fail(res.error);
  //     // This route has NO {ok:true/false} wrapper — check `items` directly.
  //     const items = Array.isArray(res.data?.items) ? res.data!.items! : [];
  //     if (items.length === 0) {
  //       return fail('제주 쇼핑·시장 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  //     }
  //     return okShopping(items, locale);
  //   },
  // );

  // 6a. find_nearby_bus_stops — POST /api/jeju/bus/nearby ───────────────────────
  server.registerTool(
    'find_nearby_bus_stops',
    {
      title: 'Find nearby Jeju bus stops',
      annotations: readOnlyAnnotations('제주 가까운 버스 정류장 찾기'),
      description:
        `[${SERVICE_NAME}] ` +
        'Find Jeju public bus stops near a coordinate (latitude/longitude). ' +
        'Returns stations with their nodeId, which you can pass to get_bus_arrivals. ' +
        'Use for "가까운 버스 정류장", "bus stops near me" (with coordinates).',
      inputSchema: {
        lat: z.number().min(-90).max(90).describe('Latitude (WGS84). Jeju is around 33.'),
        lng: z.number().min(-180).max(180).describe('Longitude (WGS84). Jeju is around 126.'),
      },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/bus/nearby', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return ok(res.data, '가까운 제주 버스 정류장입니다.');
    },
  );

  // 6b. get_bus_arrivals — POST /api/jeju/bus/arrivals ──────────────────────────
  server.registerTool(
    'get_bus_arrivals',
    {
      title: 'Get real-time Jeju bus arrivals',
      annotations: readOnlyAnnotations('제주 실시간 버스 도착 정보'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get real-time bus arrival info for a specific Jeju bus stop, identified ' +
        'by its nodeId (get one from find_nearby_bus_stops). An empty list means ' +
        'no imminent bus. Use for "버스 언제 와?", "next bus at this stop".',
      inputSchema: {
        nodeId: z
          .string()
          .min(1)
          .describe('The bus stop node id from find_nearby_bus_stops (e.g. "JJB...").'),
      },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/bus/arrivals', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return ok(res.data, '실시간 버스 도착 정보입니다.');
    },
  );

  // 6c. search_bus_route — POST /api/jeju/bus/route ─────────────────────────────
  server.registerTool(
    'search_bus_route',
    {
      title: 'Search a Jeju bus route by number',
      annotations: readOnlyAnnotations('제주 버스 노선 검색'),
      description:
        `[${SERVICE_NAME}] ` +
        'Look up a Jeju bus route by its number and get the ordered list of stops. ' +
        'Use for "몇 번 버스 노선", "where does bus 600 go".',
      inputSchema: {
        routeNo: z.string().min(1).describe('Bus route number, e.g. "600", "365".'),
      },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson<{ ok?: boolean; error?: string }>('/api/jeju/bus/route', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) {
        return fail(
          e === 'NO_ROUTE'
            ? `해당 번호의 제주 버스 노선을 찾지 못했습니다: ${args.routeNo}`
            : e,
        );
      }
      return ok(res.data, `제주 ${args.routeNo}번 버스 노선입니다.`);
    },
  );

  // 7. get_exchange_rates — GET /api/jeju/exchange ──────────────────────────────
  server.registerTool(
    'get_exchange_rates',
    {
      title: 'Get exchange rates for Jeju visitors',
      annotations: readOnlyAnnotations('제주 방문객 환율 조회'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get current KRW exchange rates for currencies relevant to Jeju visitors ' +
        '(USD, CNY, JPY, EUR, HKD, TWD). Use for "환율", "exchange rate", ' +
        '"how much is my currency in won".',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      const res = await getJson('/api/jeju/exchange');
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return ok(res.data, '제주 방문객을 위한 환율 정보입니다.');
    },
  );

  // 8. get_jeju_weather — Open-Meteo (no existing route) ────────────────────────
  server.registerTool(
    'get_jeju_weather',
    {
      title: 'Get Jeju weather forecast (5 regions)',
      annotations: readOnlyAnnotations('제주 날씨 조회'),
      description:
        `[${SERVICE_NAME}] ` +
        'Get the daily weather forecast for the 5 Jeju regions (제주시/서귀포/동부/' +
        '서부/한라산): weather condition, max/min temperature, and precipitation ' +
        'probability. Use for "제주 날씨", "will it rain in Jeju", trip weather planning.',
      inputSchema: {
        days: z
          .number()
          .int()
          .min(3)
          .max(7)
          .default(3)
          .describe('Number of forecast days (3–7). Default 3.'),
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await getJejuWeather(args.days ?? 3);
        if (!result.ok) return fail(result.error ?? '날씨 정보를 불러오지 못했습니다.');
        return ok(result, `제주 5개 권역 ${result.forecastDays}일 날씨 예보입니다.`);
      } catch (e: unknown) {
        return fail(e instanceof Error ? e.message : '날씨 조회 중 오류가 발생했습니다.');
      }
    },
  );
}
