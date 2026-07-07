/**
 * Tool registry for the Jeju MCP server.
 *
 * Every tool is a THIN PROXY over an existing deployed Next.js API route
 * (server-to-server, no auth — those routes have none). No LLM runs here.
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
import { COURSE_POLL_BUDGET_MS, COURSE_POLL_INTERVAL_MS } from './config.js';
import { getJejuWeather } from './weather.js';

// ── MCP content helpers ─────────────────────────────────────────────────────

/** Success content: a human-readable summary line + the raw JSON payload. */
function ok(payload: unknown, summary?: string): CallToolResult {
  const json = JSON.stringify(payload, null, 2);
  const text = summary ? `${summary}\n\n${json}` : json;
  return { content: [{ type: 'text', text }] };
}

/** Error content: clearly flagged so the model can relay/retry gracefully. */
function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `ERROR: ${message}` }], isError: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/** Shape of the tourist-course poll (GET ?jobId=). */
interface CoursePoll {
  ok?: boolean;
  status?: 'pending' | 'done' | 'error';
  result?: { ok?: boolean; courses?: unknown[]; error?: string };
  error?: string;
}

/**
 * Poll a course job once. Returns a discriminated outcome the caller maps to
 * MCP content: 'done' with courses, 'error', 'pending', or a transient miss.
 */
async function pollCourseOnce(
  jobId: string,
): Promise<
  | { kind: 'done'; courses: unknown[] }
  | { kind: 'error'; message: string }
  | { kind: 'pending' }
  | { kind: 'transient' }
> {
  const poll = await getJson<CoursePoll>(
    `/api/jeju/tourist-course?jobId=${encodeURIComponent(jobId)}`,
  );
  if (!poll.ok) return { kind: 'transient' };
  // Job not found (HTTP 404 → body { ok:false, error }) is a terminal error.
  if (poll.data?.ok === false) {
    return { kind: 'error', message: poll.data?.error ?? '작업을 찾을 수 없습니다.' };
  }
  const status = poll.data?.status;
  if (status === 'done') {
    const result = poll.data?.result;
    if (result?.ok) return { kind: 'done', courses: result.courses ?? [] };
    return { kind: 'error', message: result?.error ?? '코스를 만들지 못했어요. 다시 시도해 주세요.' };
  }
  if (status === 'error') {
    return { kind: 'error', message: poll.data?.error ?? '코스를 만들지 못했어요. 다시 시도해 주세요.' };
  }
  return { kind: 'pending' };
}

// Reusable body-check: many routes return { ok: false, error } with HTTP 200.
function bodyError(data: unknown): string | null {
  if (data && typeof data === 'object' && 'ok' in data && (data as { ok?: unknown }).ok === false) {
    const e = (data as { error?: unknown }).error;
    return typeof e === 'string' && e ? e : '요청이 실패했습니다 (ok:false).';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {
  // 1. plan_jeju_course — async job: START then POLL until done. ───────────────
  server.registerTool(
    'plan_jeju_course',
    {
      title: 'Plan a Jeju travel course (AI)',
      description:
        'Generate an AI-designed multi-stop Jeju (제주도) travel itinerary/course. ' +
        'Use for requests like "plan my Jeju trip", "make a one-day Jeju course", ' +
        '"제주 여행 코스 짜줘". This starts a background job and waits up to ~40s. ' +
        'If the courses are ready it returns the finished itinerary; otherwise it ' +
        'returns a jobId and a message asking the user to check again shortly — ' +
        'then call check_jeju_course with that jobId to retrieve the result.',
      inputSchema: {
        mode: z
          .enum(['standard', 'custom'])
          .default('standard')
          .describe(
            "'standard' = 4 themed day-courses. 'custom' = up to 2 courses tailored to companion/ageGroup/groupSize.",
          ),
        query: z
          .string()
          .max(500)
          .optional()
          .describe('Free-text interests or constraints, e.g. "cafes and ocean views", "아이와 함께".'),
        duration: z
          .enum(['반나절', '하루'])
          .optional()
          .describe("Trip length: '반나절' (half day) or '하루' (full day)."),
        area: z.string().max(100).optional().describe('Preferred Jeju area/region to focus on.'),
        companion: z
          .string()
          .max(100)
          .optional()
          .describe('custom mode only: who is traveling, e.g. "부모님", "친구".'),
        ageGroup: z.string().max(100).optional().describe('custom mode only: age group, e.g. "60대".'),
        groupSize: z.number().int().positive().max(100).optional().describe('custom mode only: number of people.'),
        locale: localeSchema,
      },
    },
    async (args): Promise<CallToolResult> => {
      const start = await postJson<{ ok?: boolean; jobId?: string; error?: string }>(
        '/api/jeju/tourist-course',
        args,
      );
      if (!start.ok) return fail(start.error);
      const startErr = bodyError(start.data);
      if (startErr) return fail(startErr);
      const jobId = start.data?.jobId;
      if (!jobId) return fail('작업 ID(jobId)를 받지 못했습니다.');

      // Poll only up to the short budget (~40s) so the tool call stays snappy.
      const deadline = Date.now() + COURSE_POLL_BUDGET_MS;
      while (Date.now() < deadline) {
        await sleep(COURSE_POLL_INTERVAL_MS);
        const outcome = await pollCourseOnce(jobId);
        if (outcome.kind === 'done') {
          return ok(
            { jobId, status: 'done', courses: outcome.courses },
            `제주 여행 코스가 준비되었습니다 (${outcome.courses.length}개 코스).`,
          );
        }
        if (outcome.kind === 'error') return fail(outcome.message);
        // 'pending' or 'transient' → keep polling within budget
      }

      // Not done in time — hand back the jobId for check_jeju_course.
      return ok(
        { jobId, status: 'pending' },
        `코스를 준비 중입니다. 약 1-2분 소요됩니다. 잠시 후 check_jeju_course 도구로 다시 확인해 주세요. jobId: ${jobId}`,
      );
    },
  );

  // 1b. check_jeju_course — retrieve a started course by jobId. ─────────────────
  server.registerTool(
    'check_jeju_course',
    {
      title: 'Check a Jeju course job by jobId',
      description:
        'Retrieve the result of a Jeju travel course that was started by ' +
        'plan_jeju_course but was not ready yet. Pass the jobId returned earlier. ' +
        'Returns the finished courses if ready, or a "still preparing" message if ' +
        'not done yet ("아직 준비 중"). Use when the user asks to check their course ' +
        'again ("코스 다 됐어?", "아까 그 코스 확인해줘").',
      inputSchema: {
        jobId: z
          .string()
          .min(1)
          .describe('The jobId returned by plan_jeju_course when the course was not ready.'),
      },
    },
    async (args): Promise<CallToolResult> => {
      const outcome = await pollCourseOnce(args.jobId);
      if (outcome.kind === 'done') {
        return ok(
          { jobId: args.jobId, status: 'done', courses: outcome.courses },
          `제주 여행 코스가 준비되었습니다 (${outcome.courses.length}개 코스).`,
        );
      }
      if (outcome.kind === 'error') return fail(outcome.message);
      if (outcome.kind === 'transient') {
        return fail('작업 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
      return ok(
        { jobId: args.jobId, status: 'pending' },
        '아직 코스를 준비 중입니다. 잠시 후 다시 확인해 주세요.',
      );
    },
  );

  // 2. find_hidden_spots — POST /api/jeju/tourist-local ─────────────────────────
  server.registerTool(
    'find_hidden_spots',
    {
      title: 'Find hidden local Jeju spots',
      description:
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
      return ok(res.data, '제주 숨은 로컬 명소를 찾았습니다.');
    },
  );

  // 3. get_jeju_seasonal — POST /api/jeju/tourist-seasonal ──────────────────────
  server.registerTool(
    'get_jeju_seasonal',
    {
      title: 'Get seasonal Jeju highlights (right now)',
      description:
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
      return ok(res.data, '지금 제주의 계절 명소입니다.');
    },
  );

  // 4. get_jeju_festivals — POST /api/jeju/tourist-festivals ────────────────────
  server.registerTool(
    'get_jeju_festivals',
    {
      title: 'Get current Jeju festivals & events',
      description:
        'Get festivals and events happening in Jeju now / soon. Use for ' +
        '"제주 축제", "events in Jeju this month".',
      inputSchema: { locale: localeSchema },
    },
    async (args): Promise<CallToolResult> => {
      const res = await postJson('/api/jeju/tourist-festivals', args);
      if (!res.ok) return fail(res.error);
      const e = bodyError(res.data);
      if (e) return fail(e);
      return ok(res.data, '제주의 축제·행사 정보입니다.');
    },
  );

  // 5. get_jeju_trending — POST /api/jeju/tourist-featured ──────────────────────
  server.registerTool(
    'get_jeju_trending',
    {
      title: 'Get trending / featured Jeju places',
      description:
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
      return ok(res.data, '지금 뜨는 제주 명소입니다.');
    },
  );

  // 5b. get_rainy_day_spots — POST /api/jeju/tourist (fixed rainy query) ────────
  server.registerTool(
    'get_rainy_day_spots',
    {
      title: 'Get rainy-day / indoor Jeju spots',
      description:
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
      return ok(res.data, '비 와도 좋은 제주 실내 명소입니다.');
    },
  );

  // 5c. get_jeju_islands — POST /api/jeju/tourist-ferry ─────────────────────────
  server.registerTool(
    'get_jeju_islands',
    {
      title: 'Get Jeju ferry island day-trips',
      description:
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
      return ok(res.data, '제주 섬 여행(배편) 정보입니다.');
    },
  );

  // 5d. get_olle_trails — GET /api/jeju/tourist-olle ────────────────────────────
  server.registerTool(
    'get_olle_trails',
    {
      title: 'Get Jeju Olle trail courses',
      description:
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
      return ok(res.data, '제주 올레길 코스 목록입니다.');
    },
  );

  // 5e. get_oreum_hallasan — GET /api/jeju/tourist-oreum ────────────────────────
  server.registerTool(
    'get_oreum_hallasan',
    {
      title: 'Get Jeju oreum (volcanic cones) & Hallasan',
      description:
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
      return ok(res.data, '제주 오름·한라산 트레킹 정보입니다.');
    },
  );

  // 6a. find_nearby_bus_stops — POST /api/jeju/bus/nearby ───────────────────────
  server.registerTool(
    'find_nearby_bus_stops',
    {
      title: 'Find nearby Jeju bus stops',
      description:
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
      description:
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
      description:
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
      description:
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
      description:
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
