/**
 * Runtime configuration, read from environment variables.
 *
 * APP_BASE_URL — origin of the deployed Next.js app whose /api/jeju/* routes
 *                this MCP server proxies (e.g. https://www.aimani.ai). Required
 *                in practice; falls back to the production host so the server
 *                still boots for a health check if the var is missing.
 * PORT         — HTTP port to listen on (Kakao Cloud injects this). Default 3000.
 * HOST         — bind address. Default 0.0.0.0 (required for containers/cloud).
 */

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const APP_BASE_URL = trimTrailingSlash(
  process.env.APP_BASE_URL?.trim() || 'https://www.aimani.ai',
);

export const PORT = Number(process.env.PORT) || 3000;

export const HOST = process.env.HOST?.trim() || '0.0.0.0';

/** Default per-request upstream timeout (ms) for normal proxy calls. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Course polling budget for plan_jeju_course (ms). Kept short (~40s) so the tool
 * call returns well within Kakao AI chat's short-response window. If the job
 * isn't done in time we hand back the jobId and the user re-checks via
 * check_jeju_course.
 */
export const COURSE_POLL_BUDGET_MS = 40_000;

/** Interval between course job polls (ms). */
export const COURSE_POLL_INTERVAL_MS = 3_000;

export const SERVER_NAME = 'jeju-tourist-mcp';
export const SERVER_VERSION = '1.0.0';
