import { describe, expect, it, afterEach } from 'vitest';
import {
  collectSecretValues,
  isSentryEnabled,
  readSampleRate,
  redactSecrets,
} from './observability';

/**
 * The scrub in this module is the last line of defence before a stack trace
 * or a log line reaches Sentry, and the secrets it protects (CLAUDE.md,
 * docs/09) are exactly the ones a database driver or an S3 client would
 * happily print into an exception message. Asserted directly rather than
 * trusted, on both the redaction and the "when is Sentry even on" gates.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('redactSecrets', () => {
  it('replaces a secret value found inside a plain string', () => {
    expect(redactSecrets('error: could not reach postgres://u:p@host/db', [
      'postgres://u:p@host/db',
    ])).toBe('error: could not reach [redacted]');
  });

  it('redacts every occurrence, not just the first', () => {
    const out = redactSecrets('secret secret', ['secret']);
    expect(out).toBe('[redacted] [redacted]');
  });

  it('walks nested objects and arrays', () => {
    const event = {
      message: 'DATABASE_URL=postgres://u:p@host/db failed',
      extra: { breadcrumbs: ['connecting to postgres://u:p@host/db'] },
      list: [{ deep: 'postgres://u:p@host/db' }],
    };
    const out = redactSecrets(event, ['postgres://u:p@host/db']);
    expect(out.message).toBe('DATABASE_URL=[redacted] failed');
    expect(out.extra.breadcrumbs[0]).toBe('connecting to [redacted]');
    expect(out.list[0]?.deep).toBe('[redacted]');
  });

  it('leaves unrelated values untouched', () => {
    const event = { message: 'ministry not found', count: 3, ok: true, nothing: null };
    expect(redactSecrets(event, ['some-secret'])).toEqual(event);
  });

  it('is a no-op with no secrets configured', () => {
    const event = { message: 'anything at all' };
    expect(redactSecrets(event, [])).toEqual(event);
  });
});

describe('collectSecretValues', () => {
  it('reads the declared secret env vars and skips short placeholders', () => {
    process.env.DATABASE_URL = 'postgres://nidhi:nidhi@localhost:5433/nidhi';
    process.env.REDIS_URL = 'redis://localhost:6380';
    process.env.S3_ACCESS_KEY = 'nidhiminio';
    process.env.S3_SECRET_KEY = 'nidhiminio123';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-abcdef123456';
    process.env.ADMIN_REVIEW_TOKEN = 'change-me-locally';
    process.env.OGD_API_KEY = 'should-not-be-collected';

    const values = collectSecretValues();
    expect(values).toContain('postgres://nidhi:nidhi@localhost:5433/nidhi');
    expect(values).toContain('sk-ant-abcdef123456');
    expect(values).not.toContain('should-not-be-collected');
  });

  it('returns nothing for unset vars', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ADMIN_REVIEW_TOKEN;
    expect(collectSecretValues()).toEqual([]);
  });
});

describe('isSentryEnabled', () => {
  it('is false for undefined, empty, and whitespace-only DSNs', () => {
    expect(isSentryEnabled(undefined)).toBe(false);
    expect(isSentryEnabled('')).toBe(false);
    expect(isSentryEnabled('   ')).toBe(false);
  });

  it('is true for a real-looking DSN', () => {
    expect(isSentryEnabled('https://key@o0.ingest.sentry.io/1')).toBe(true);
  });
});

describe('readSampleRate', () => {
  it('falls back when unset', () => {
    expect(readSampleRate(undefined, 0.05)).toBe(0.05);
    expect(readSampleRate('', 0.05)).toBe(0.05);
  });

  it('falls back on a value outside [0, 1] rather than clamping', () => {
    expect(readSampleRate('5', 0.05)).toBe(0.05);
    expect(readSampleRate('-1', 0.05)).toBe(0.05);
  });

  it('falls back on garbage', () => {
    expect(readSampleRate('not-a-number', 0.05)).toBe(0.05);
  });

  it('accepts a well-formed rate', () => {
    expect(readSampleRate('0.2', 0.05)).toBe(0.2);
    expect(readSampleRate('1', 0.05)).toBe(1);
    expect(readSampleRate('0', 0.05)).toBe(0);
  });
});
