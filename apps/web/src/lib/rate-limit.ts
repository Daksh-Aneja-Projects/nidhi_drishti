import net from 'node:net';
import tls from 'node:tls';

/**
 * Token bucket rate limiter for the public API (docs/02 section 7).
 *
 * Redis is the shared bucket, so several web instances enforce one limit rather
 * than one each. Redis is also the first thing to disappear on a small
 * deployment, and a transparency site that returns 500 because its cache is
 * down is worse than one that rate limits slightly loosely, so the limiter
 * degrades to an in-process bucket and says so in the log and in the response
 * headers. It never fails open silently and it never throws into a request.
 *
 * The Redis client here speaks RESP over a raw socket rather than pulling in a
 * driver. The whole protocol surface we need is two commands, and the bucket
 * arithmetic runs inside one EVAL so that concurrent requests cannot interleave
 * a read and a write.
 */

/* ------------------------------------------------------------------ *
 * Minimal RESP client
 * ------------------------------------------------------------------ */

type RedisValue = string | number | null | RedisValue[];

interface Pending {
  resolve: (value: RedisValue) => void;
  reject: (error: Error) => void;
}

const COMMAND_TIMEOUT_MS = 400;
const CONNECT_TIMEOUT_MS = 800;
/** After a failure, stop dialling Redis for this long. */
const COOLDOWN_MS = 30_000;

function encodeCommand(args: ReadonlyArray<string | number>): Buffer {
  const parts: string[] = [`*${args.length}\r\n`];
  for (const arg of args) {
    const text = String(arg);
    parts.push(`$${Buffer.byteLength(text)}\r\n${text}\r\n`);
  }
  return Buffer.from(parts.join(''), 'utf8');
}

/** Parse one reply from `buffer` at `offset`, or null when it is incomplete. */
function parseReply(buffer: Buffer, offset: number): { value: RedisValue; next: number } | null {
  if (offset >= buffer.length) return null;
  const lineEnd = buffer.indexOf('\r\n', offset);
  if (lineEnd === -1) return null;
  const kind = String.fromCharCode(buffer[offset]);
  const line = buffer.toString('utf8', offset + 1, lineEnd);
  const afterLine = lineEnd + 2;

  switch (kind) {
    case '+':
      return { value: line, next: afterLine };
    case '-':
      throw new Error(line);
    case ':':
      return { value: Number(line), next: afterLine };
    case '$': {
      const length = Number(line);
      if (length === -1) return { value: null, next: afterLine };
      const end = afterLine + length;
      if (buffer.length < end + 2) return null;
      return { value: buffer.toString('utf8', afterLine, end), next: end + 2 };
    }
    case '*': {
      const count = Number(line);
      if (count === -1) return { value: null, next: afterLine };
      const items: RedisValue[] = [];
      let cursor = afterLine;
      for (let index = 0; index < count; index += 1) {
        const item = parseReply(buffer, cursor);
        if (!item) return null;
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error('Unrecognised reply from the cache.');
  }
}

interface RedisTarget {
  host: string;
  port: number;
  useTls: boolean;
  password: string | null;
  username: string | null;
  db: number | null;
}

/**
 * Parse REDIS_URL. Returns null when unset or unparseable, which means the
 * limiter runs in process and health reports the cache as not configured.
 */
function readTarget(): RedisTarget | null {
  const raw = process.env.REDIS_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const useTls = url.protocol === 'rediss:';
    const path = url.pathname.replace(/^\//, '');
    return {
      host: url.hostname || '127.0.0.1',
      port: url.port ? Number(url.port) : 6379,
      useTls,
      password: url.password ? decodeURIComponent(url.password) : null,
      username: url.username ? decodeURIComponent(url.username) : null,
      db: path === '' ? null : Number(path),
    };
  } catch {
    return null;
  }
}

class RedisConnection {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Pending[] = [];
  private ready: Promise<void> | null = null;
  private unavailableUntil = 0;

  constructor(private readonly target: RedisTarget) {}

  get inCooldown(): boolean {
    return Date.now() < this.unavailableUntil;
  }

  private teardown(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.ready = null;
    this.buffer = Buffer.alloc(0);
    const waiting = this.pending;
    this.pending = [];
    for (const item of waiting) item.reject(error);
    if (socket) socket.destroy();
    this.unavailableUntil = Date.now() + COOLDOWN_MS;
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let parsed: { value: RedisValue; next: number } | null;
      try {
        parsed = parseReply(this.buffer, 0);
      } catch (error) {
        // An error reply belongs to the oldest in-flight command; the stream
        // itself is still in sync, so consume the line and reject that command.
        const lineEnd = this.buffer.indexOf('\r\n');
        this.buffer = lineEnd === -1 ? Buffer.alloc(0) : this.buffer.subarray(lineEnd + 2);
        this.pending.shift()?.reject(error instanceof Error ? error : new Error('Cache error.'));
        continue;
      }
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.next);
      this.pending.shift()?.resolve(parsed.value);
    }
  }

  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const { host, port, useTls } = this.target;
      const socket = useTls
        ? tls.connect({ host, port, servername: host })
        : net.createConnection({ host, port });

      const settle = (error?: Error) => {
        socket.removeListener('error', onError);
        socket.setTimeout(0);
        if (error) reject(error);
        else resolve();
      };
      const onError = (error: Error) => {
        this.teardown(error);
        settle(error);
      };

      socket.setNoDelay(true);
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => onError(new Error('Cache connect timed out.')));
      socket.once('error', onError);
      socket.on('data', (chunk: Buffer) => this.onData(chunk));
      socket.on('close', () => {
        if (this.socket === socket) this.teardown(new Error('Cache connection closed.'));
      });
      socket.once(useTls ? 'secureConnect' : 'connect', () => {
        this.socket = socket;
        socket.on('error', (error: Error) => {
          if (this.socket === socket) this.teardown(error);
        });
        const handshake: Array<Promise<RedisValue>> = [];
        if (this.target.password) {
          handshake.push(
            this.target.username
              ? this.send(['AUTH', this.target.username, this.target.password])
              : this.send(['AUTH', this.target.password]),
          );
        }
        if (this.target.db !== null && Number.isFinite(this.target.db) && this.target.db > 0) {
          handshake.push(this.send(['SELECT', String(this.target.db)]));
        }
        Promise.all(handshake).then(
          () => settle(),
          (error: unknown) => onError(error instanceof Error ? error : new Error('Cache refused.')),
        );
      });
    });
    return this.ready;
  }

  /** Write a command without waiting for the connection handshake. */
  private send(args: ReadonlyArray<string | number>): Promise<RedisValue> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('Cache is not connected.'));
    return new Promise<RedisValue>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      socket.write(encodeCommand(args));
    });
  }

  async command(args: ReadonlyArray<string | number>): Promise<RedisValue> {
    if (this.inCooldown) throw new Error('Cache is in cooldown after a recent failure.');
    await this.connect();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.send(args),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // A timed-out command leaves the reply stream ambiguous, so the
            // connection is dropped rather than reused out of step.
            this.teardown(new Error('Cache command timed out.'));
            reject(new Error('Cache command timed out.'));
          }, COMMAND_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

let connection: RedisConnection | null | undefined;

function getConnection(): RedisConnection | null {
  if (connection !== undefined) return connection;
  const target = readTarget();
  connection = target ? new RedisConnection(target) : null;
  return connection;
}

export function isCacheConfigured(): boolean {
  return readTarget() !== null;
}

/** Health probe for /api/health. Never returns a connection string. */
export async function pingCache(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const client = getConnection();
  if (!client) return { ok: false, latencyMs: 0, error: 'Not configured.' };
  const started = Date.now();
  try {
    await client.command(['PING']);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    // Deliberately not the driver message: it can carry the host and port.
    return { ok: false, latencyMs: Date.now() - started, error: 'Cache is unreachable.' };
  }
}

/* ------------------------------------------------------------------ *
 * The bucket
 * ------------------------------------------------------------------ */

/**
 * Refill and take one token in a single round trip. Written as a script so the
 * read, the arithmetic and the write cannot interleave with another request.
 */
const BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
local retry = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) / refill)
end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)
return {allowed, math.floor(tokens), retry}
`;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds to wait before retrying. Zero when the request was allowed. */
  retryAfterSeconds: number;
  backend: 'shared' | 'in_process';
}

interface MemoryBucket {
  tokens: number;
  ts: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();
const MEMORY_BUCKET_CAP = 20_000;
let lastFallbackLog = 0;

function logFallback(reason: string): void {
  const now = Date.now();
  // Throttled, because a Redis outage would otherwise write one line per
  // request. Never silent: the operator must be able to see the degradation.
  if (now - lastFallbackLog < COOLDOWN_MS) return;
  lastFallbackLog = now;
  console.warn(
    `[rate-limit] shared cache unavailable, falling back to the in-process limiter: ${reason}`,
  );
}

function consumeInProcess(key: string, capacity: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const refill = capacity / windowMs;

  if (memoryBuckets.size > MEMORY_BUCKET_CAP) {
    for (const [bucketKey, bucket] of memoryBuckets) {
      if (now - bucket.ts > windowMs * 2) memoryBuckets.delete(bucketKey);
    }
    if (memoryBuckets.size > MEMORY_BUCKET_CAP) memoryBuckets.clear();
  }

  const existing = memoryBuckets.get(key) ?? { tokens: capacity, ts: now };
  const elapsed = Math.max(0, now - existing.ts);
  let tokens = Math.min(capacity, existing.tokens + elapsed * refill);
  let allowed = false;
  let retryMs = 0;
  if (tokens >= 1) {
    tokens -= 1;
    allowed = true;
  } else {
    retryMs = Math.ceil((1 - tokens) / refill);
  }
  memoryBuckets.set(key, { tokens, ts: now });
  return {
    allowed,
    limit: capacity,
    remaining: Math.floor(tokens),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryMs / 1000)),
    backend: 'in_process',
  };
}

/**
 * Take one token for `identifier`.
 *
 * Resolves rather than throws in every failure mode: an exception here would
 * turn a cache outage into a broken API.
 */
export async function consumeRateLimit(
  identifier: string,
  capacity: number,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const key = `ratelimit:api:${identifier}`;
  const client = getConnection();

  if (!client) {
    // Unconfigured is a deployment choice rather than a fault, so it is logged
    // once through the same throttle and then handled quietly.
    logFallback('REDIS_URL is not set');
    return consumeInProcess(key, capacity, windowMs);
  }

  try {
    const reply = await client.command([
      'EVAL',
      BUCKET_SCRIPT,
      1,
      key,
      capacity,
      capacity / windowMs,
      Date.now(),
      windowMs * 2,
    ]);
    if (!Array.isArray(reply) || reply.length < 3) {
      throw new Error('Unexpected reply shape.');
    }
    const allowed = Number(reply[0]) === 1;
    const remaining = Number(reply[1]);
    const retryMs = Number(reply[2]);
    return {
      allowed,
      limit: capacity,
      remaining: Number.isFinite(remaining) ? Math.max(0, remaining) : 0,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryMs / 1000)),
      backend: 'shared',
    };
  } catch (error) {
    logFallback(error instanceof Error ? error.message : 'unknown cache error');
    return consumeInProcess(key, capacity, windowMs);
  }
}
