/**
 * Shared plumbing for the three Sentry entry points (docs/09 plane B):
 * `sentry.client.config.ts`, `sentry.server.config.ts` and
 * `sentry.edge.config.ts`. Kept in one module so the scrubbing rule is written
 * once and applied identically everywhere, rather than re-implemented three
 * times with three chances to drift.
 *
 * Sentry here is strictly system observability, never surfaced in the UI
 * (docs/09 section B): nothing in this module renders anything, and no page
 * imports it directly.
 */

/**
 * Env vars whose *values* must never leave the process in an event payload.
 * Connection strings and API keys can appear inside an error message (a
 * driver that includes its DSN in an exception, a fetch that logs its own
 * request URL) even though nothing here intentionally logs them, so the
 * scrub works on values rather than trying to enumerate every field that
 * might carry one.
 */
const SECRET_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'ANTHROPIC_API_KEY',
  'ADMIN_REVIEW_TOKEN',
] as const;

const REDACTED = '[redacted]';

/**
 * The current secret values, read fresh on every call rather than cached at
 * module load: `beforeSend` runs long after the config file is evaluated, and
 * a cached empty list from a moment before the environment was populated
 * would silently stop scrubbing for the life of the process.
 */
export function collectSecretValues(): string[] {
  if (typeof process === 'undefined' || !process.env) return [];
  const values: string[] = [];
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    // A short value (empty, or a placeholder like "change-me-locally" of a
    // couple of characters) is not worth scanning every string for; it would
    // only produce false-positive redactions of ordinary short substrings.
    if (typeof value === 'string' && value.length >= 6) values.push(value);
  }
  return values;
}

/** Recursively replace any occurrence of a secret value inside `value`. */
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  if (typeof value === 'string') {
    // Typed explicitly as `string` rather than inferred from `value`: the
    // `typeof` guard narrows `value` to `T & string`, and split().join()
    // produces a plain `string` that is not assignable back to that
    // intersection.
    let out: string = value;
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    return out as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secrets)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSecrets(child, secrets);
    }
    return out as T;
  }
  return value;
}

/**
 * `beforeSend` / `beforeSendTransaction` for every Sentry config.
 *
 * Applied unconditionally: even with `sendDefaultPii: false`, Sentry still
 * captures exception messages, breadcrumbs and request URLs verbatim, and any
 * of those can contain a secret pulled from the environment by application
 * code. This is the last line of defence before the event leaves the process.
 */
export function scrubEvent<T>(event: T): T {
  return redactSecrets(event, collectSecretValues());
}

/** A DSN of only whitespace is treated the same as unset. */
export function isSentryEnabled(dsn: string | undefined): dsn is string {
  return typeof dsn === 'string' && dsn.trim().length > 0;
}

/**
 * A sample rate from the environment, defaulted and clamped to [0, 1].
 *
 * An operator fat-fingering `SENTRY_TRACES_SAMPLE_RATE=5` should get the
 * documented low default, not five hundred percent of traffic traced.
 */
export function readSampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}
