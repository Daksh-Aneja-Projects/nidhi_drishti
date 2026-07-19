import { NextResponse } from 'next/server';
import {
  SITE_DISCLAIMER,
  isFiscalYear,
  type ApiEnvelope,
  type DataMode,
  type FiscalYear,
  type SourceFreshness,
} from '@nidhi/core';
import { getSourceFreshness, listSourceRegistry } from '@nidhi/db';
import { getDataMode, resolveFy, siteUrl } from '@/lib/site';
import { consumeRateLimit } from '@/lib/rate-limit';

/**
 * Shared plumbing for the public read-only API.
 *
 * The envelope is the point of this module. A consumer pulling JSON gets the
 * same honesty guarantees a reader of a page gets: which financial year the
 * figures belong to, whether the deployment is serving illustrative figures,
 * how fresh each underlying source is, and the disclaimer. None of that is
 * optional, so it is assembled here rather than left to each route.
 */

/** The entity id the canonical model uses for the union total (db/seed). */
export const NATIONAL_ENTITY_ID = 'india';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_fiscal_year'
  | 'unknown_view'
  | 'not_found'
  | 'rate_limited'
  | 'unavailable';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/** Thrown inside a route and turned into a response by `handleApiFailure`. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  headers: Record<string, string> = {},
): NextResponse<ApiErrorBody> {
  return NextResponse.json<ApiErrorBody>(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

/**
 * Turn any thrown value into a response.
 *
 * Database and cache messages can carry hostnames and credentials, so nothing
 * from an unexpected error reaches the client. It is logged instead.
 */
export function handleApiFailure(error: unknown, route: string): NextResponse<ApiErrorBody> {
  if (error instanceof ApiFailure) {
    return apiError(error.status, error.code, error.message);
  }
  console.error(`[api] ${route} failed`, error);
  return apiError(
    503,
    'unavailable',
    'The figures could not be read from the store just now. Try again shortly.',
  );
}

/* ------------------------------------------------------------------ *
 * Request parsing
 * ------------------------------------------------------------------ */

/**
 * The financial year for a request.
 *
 * A malformed `fy` is a 400 rather than a silent fallback: answering a question
 * the caller did not ask, with a different year's figures, is the kind of
 * quietly wrong behaviour this product cannot afford. A well-formed year with
 * no data is legitimate and returns an empty result for that year.
 */
export async function resolveApiFy(url: URL): Promise<FiscalYear> {
  const requested = url.searchParams.get('fy');
  if (requested !== null && requested !== '') {
    if (!isFiscalYear(requested)) {
      throw new ApiFailure(
        400,
        'invalid_fiscal_year',
        'The fy parameter must be a financial year label such as FY2026, named for the year the year ends.',
      );
    }
    return requested;
  }
  const { fy } = await resolveFy();
  return fy;
}

/** A bounded integer query parameter. Out of range clamps rather than fails. */
export function readLimit(url: URL, fallback: number, max: number): number {
  const raw = url.searchParams.get('limit');
  if (raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiFailure(400, 'invalid_request', 'The limit parameter must be a positive number.');
  }
  return Math.min(Math.floor(parsed), max);
}

/** One of a fixed set, or a 400 naming the accepted values. */
export function readEnum<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new ApiFailure(
    400,
    'invalid_request',
    `The ${name} parameter must be one of: ${allowed.join(', ')}.`,
  );
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

const DEFAULT_RATE_LIMIT = 60;

function readRateLimit(): number {
  const raw = Number(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RATE_LIMIT;
}

/**
 * Best available client address.
 *
 * Only the first hop of X-Forwarded-For is used, and it is never logged or
 * stored: it exists for the length of one bucket update (docs/08 section 4).
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export interface RateLimitOutcome {
  /** Present when the request must be refused. */
  response: NextResponse<ApiErrorBody> | null;
  /** Headers to attach to a successful response. */
  headers: Record<string, string>;
}

export async function enforceRateLimit(request: Request): Promise<RateLimitOutcome> {
  const limit = readRateLimit();
  const result = await consumeRateLimit(clientAddress(request), limit);
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Policy': result.backend === 'shared' ? 'shared' : 'per-instance',
  };
  if (result.allowed) return { response: null, headers };
  return {
    response: apiError(
      429,
      'rate_limited',
      `This address has used its allowance of ${result.limit} requests a minute. Wait ${result.retryAfterSeconds} ${result.retryAfterSeconds === 1 ? 'second' : 'seconds'} and try again.`,
      { ...headers, 'Retry-After': String(result.retryAfterSeconds) },
    ),
    headers,
  };
}

/* ------------------------------------------------------------------ *
 * Internal surfaces
 * ------------------------------------------------------------------ */

/**
 * Gate for the operations and review surfaces.
 *
 * This is a shared secret, not an authentication system. It has no accounts, no
 * sessions and no audit of who holds the token, and docs/02 section 7 puts a
 * real provider behind the review queue before it carries any weight. It exists
 * so that an internal page is not simply open on a public deployment.
 *
 * The token is read from a cookie or a header; an unset ADMIN_REVIEW_TOKEN
 * closes the surface rather than opening it.
 */
export async function hasInternalAccess(): Promise<boolean> {
  const expected = process.env.ADMIN_REVIEW_TOKEN;
  if (!expected) return false;

  const { cookies, headers } = await import('next/headers');
  const [cookieBag, headerBag] = await Promise.all([cookies(), headers()]);
  const supplied =
    cookieBag.get('admin_review_token')?.value ?? headerBag.get('x-admin-review-token') ?? '';
  if (supplied.length !== expected.length) return false;

  const { timingSafeEqual } = await import('node:crypto');
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

/**
 * Replace the NOT_REPORTED symbol with null throughout a payload.
 *
 * JSON.stringify drops a property whose value is a symbol, so without this an
 * absent figure would vanish from the response and a consumer would have no way
 * to distinguish "not published" from "field removed". Null is the wire form of
 * absence, and the API documentation states plainly that it is not a zero.
 */
export function toJsonSafe(value: unknown): unknown {
  // NOT_REPORTED is the only symbol that reaches a payload, and any other one
  // would be a bug that must not be serialised as a number either.
  if (typeof value === 'symbol') return null;
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonSafe(child);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * The envelope
 * ------------------------------------------------------------------ */

export interface EnvelopeMeta {
  fy: FiscalYear;
  generatedAt: string;
  dataMode: DataMode;
  freshness: SourceFreshness[];
  disclaimer: string;
}

/**
 * Freshness and data mode for the envelope.
 *
 * Tolerant of a freshness lookup failing: a response that carries the figures
 * but an empty freshness list is better than no response, and an empty list is
 * itself readable as "freshness could not be established".
 */
export async function buildMeta(fy: FiscalYear): Promise<EnvelopeMeta> {
  let dataMode: DataMode = 'live';
  let freshness: SourceFreshness[] = [];
  try {
    [dataMode, freshness] = await Promise.all([getDataMode(), getSourceFreshness()]);
  } catch (error) {
    console.error('[api] could not read freshness for the envelope', error);
  }
  return {
    fy,
    generatedAt: new Date().toISOString(),
    dataMode,
    freshness,
    disclaimer: SITE_DISCLAIMER,
  };
}

/**
 * Cache windows, tuned to the cadence of the pipeline behind each view
 * (docs/02 section 6). Nothing here changes faster than a source publishes.
 */
export const CACHE_SECONDS = {
  /** Monthly accounts: the figures move once a month. */
  fiscal: 900,
  /** Registry and freshness: cheap, and staleness here is itself misleading. */
  operational: 300,
  /** Reviewed signals: changes when a human approves one. */
  signals: 600,
} as const;

function cacheHeader(sMaxAge: number): string {
  return `public, max-age=60, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 4}`;
}

export async function jsonEnvelope<T>(
  data: T,
  fy: FiscalYear,
  options: { sMaxAge: number; headers?: Record<string, string> },
): Promise<NextResponse> {
  const envelope: ApiEnvelope<T> = { data, meta: await buildMeta(fy) };
  const body = JSON.stringify(toJsonSafe(envelope));
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheHeader(options.sMaxAge),
      ...options.headers,
    },
  });
}

/* ------------------------------------------------------------------ *
 * CSV exports
 * ------------------------------------------------------------------ */

export interface ExportSource {
  name: string;
  url: string | null;
  documentDate: string | null;
}

/**
 * The sources named in every export preamble.
 *
 * A CSV that leaves the site without its sources attached is exactly the file
 * that ends up quoted with no way to check it, so this is assembled from the
 * registry and the freshness view together and failure yields an empty list
 * rather than an export with no preamble.
 */
export async function loadExportSources(): Promise<ExportSource[]> {
  try {
    const [registry, freshness] = await Promise.all([listSourceRegistry(), getSourceFreshness()]);
    const dateBySource = new Map(freshness.map((entry) => [entry.sourceId, entry]));
    return registry.map((entry) => ({
      name: entry.name,
      url: entry.homepageUrl,
      documentDate: dateBySource.get(entry.sourceId)?.latestDocumentDate ?? null,
    }));
  } catch (error) {
    console.error('[api] could not assemble export sources', error);
    return [];
  }
}

export function csvResponse(
  body: string,
  filename: string,
  headers: Record<string, string> = {},
): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': cacheHeader(CACHE_SECONDS.fiscal),
      ...headers,
    },
  });
}

export { siteUrl };
