/**
 * Small fetch helpers shared by every tool.
 *
 * Design contract (mirrors the discipline of the upstream Jeju routes):
 *   - NEVER throw. Every call resolves to a discriminated result so a tool can
 *     turn any failure into clear MCP tool content.
 *   - Enforce a per-call timeout via AbortSignal so a hung upstream can't wedge
 *     the MCP request.
 *   - Many upstream routes return HTTP 200 with { ok: false, ... }; callers must
 *     inspect the BODY, not just the status. These helpers return the parsed
 *     body plus the status so callers can do that.
 */

import { APP_BASE_URL, DEFAULT_TIMEOUT_MS } from './config.js';

export type FetchOutcome<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; error: string; status?: number };

interface RequestOptions {
  timeoutMs?: number;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
}

function timeoutSignal(ms: number): AbortSignal {
  // Node 18+/20+/24 all support AbortSignal.timeout.
  return AbortSignal.timeout(ms);
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON upstream (e.g. an HTML error page) — surface a trimmed snippet.
    return { _raw: text.slice(0, 500) };
  }
}

/** POST a JSON body to an APP_BASE_URL-relative path. */
export async function postJson<T = unknown>(
  path: string,
  body: unknown,
  opts: RequestOptions = {},
): Promise<FetchOutcome<T>> {
  const url = `${APP_BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...opts.headers,
      },
      body: JSON.stringify(body ?? {}),
      signal: timeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const data = (await parseBody(res)) as T;
    return { ok: true, status: res.status, data };
  } catch (e: unknown) {
    return { ok: false, error: describeFetchError(e, url) };
  }
}

/** GET an APP_BASE_URL-relative path. */
export async function getJson<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<FetchOutcome<T>> {
  const url = `${APP_BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...opts.headers },
      signal: timeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const data = (await parseBody(res)) as T;
    return { ok: true, status: res.status, data };
  } catch (e: unknown) {
    return { ok: false, error: describeFetchError(e, url) };
  }
}

/** GET an absolute URL (used for third-party APIs like Open-Meteo). */
export async function getAbsolute<T = unknown>(
  url: string,
  opts: RequestOptions = {},
): Promise<FetchOutcome<T>> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...opts.headers },
      signal: timeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const data = (await parseBody(res)) as T;
    return { ok: true, status: res.status, data };
  } catch (e: unknown) {
    return { ok: false, error: describeFetchError(e, url) };
  }
}

function describeFetchError(e: unknown, url: string): string {
  const name = (e as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `요청 시간이 초과되었습니다 (timeout). URL: ${url}`;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return `요청에 실패했습니다 (network error): ${msg}. URL: ${url}`;
}
