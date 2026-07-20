/**
 * The daily digest (docs/05 A6, docs/07 v1.1).
 *
 * Assembly only. Everything here was already published on this site, cleared by
 * the same review that let it onto a page, and nothing in this module is
 * capable of producing a sentence that a person has not already approved. That
 * is not a stylistic preference: A6 says "no new claims", and the surest way to
 * make no new claims is to have nothing in the path that can make one.
 *
 * There is no digest table and no migration behind this. An edition is a view
 * over `anomaly_flag` and `evidence_item` bucketed by day, both of which
 * already carry the dates and the review status the digest needs. A stored copy
 * would be a second record of the same facts, free to drift away from the
 * first, and the first is the one the rest of the site reads.
 *
 * There is deliberately no subscriber table and no email path. docs/08 section
 * 4 is explicit that v1 collects no personal data, and an email list would pull
 * in DPDP consent, purpose limitation and delete-on-request obligations for a
 * feature that RSS already delivers without knowing who is reading. If an email
 * digest is ever wanted, it belongs behind a consent record and a deletion
 * route, and that is a decision to take deliberately rather than to arrive at
 * by adding a column here.
 */

import type { EvidenceItem } from '@nidhi/core';
import {
  listDigestDays,
  listPublishedEvidence,
  listPublishedFlags,
  type PublishedFlag,
} from '@nidhi/db';

/** Editions are calendar days in India, the timezone the site displays in. */
const IST = 'Asia/Kolkata';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const istDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Today's edition date.
 *
 * `en-CA` is used because it formats as `YYYY-MM-DD`, which lets the timezone
 * conversion and the string formatting happen in one step that cannot drift.
 */
export function istToday(now: Date = new Date()): string {
  return istDayFormatter.format(now);
}

/**
 * True for a well-formed calendar day that actually exists.
 *
 * The round trip through Date rejects `2026-02-31`, which passes the pattern
 * but is not a day. An address that is not a day is a 404 rather than an empty
 * edition, so that a typo does not read as "nothing was published".
 */
export function isDigestDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export interface DigestEdition {
  /** The IST calendar day this edition covers, `YYYY-MM-DD`. */
  day: string;
  /** Signals that cleared review on this day. Approved only, by construction. */
  flags: PublishedFlag[];
  /** Evidence summarised and published on this day. */
  evidence: EvidenceItem[];
  /** True when nothing was published. A legitimate outcome, not an error. */
  isQuiet: boolean;
  /** True when the store could not be read, which is a different thing entirely. */
  degraded: boolean;
}

const FLAG_LIMIT = 50;
const EVIDENCE_LIMIT = 50;

/**
 * Assemble one edition.
 *
 * A failed read returns a degraded edition rather than throwing. A quiet day
 * and an unreachable database look identical if both render as an empty page,
 * and they mean opposite things: one says nothing happened, the other says we
 * do not know. The caller renders them differently.
 */
export async function loadDigest(day: string): Promise<DigestEdition> {
  try {
    const [flags, evidence] = await Promise.all([
      listPublishedFlags({ day, limit: FLAG_LIMIT }),
      listPublishedEvidence({ day, limit: EVIDENCE_LIMIT }),
    ]);
    return {
      day,
      flags,
      evidence,
      isQuiet: flags.length === 0 && evidence.length === 0,
      degraded: false,
    };
  } catch (error) {
    console.error('[digest] could not assemble the edition', error);
    return { day, flags: [], evidence: [], isQuiet: false, degraded: true };
  }
}

/** Recent days with something in them, newest first. Empty on any failure. */
export async function loadDigestDays(limit = 14): Promise<string[]> {
  try {
    return await listDigestDays(limit);
  } catch (error) {
    console.error('[digest] could not list the editions', error);
    return [];
  }
}

/**
 * The material behind the site-wide feed: the most recent published signals and
 * summarised activity, regardless of which day they landed on.
 *
 * Separate from an edition because a feed reader wants the last N items, not
 * the last N items that happen to share a date with today.
 */
export async function loadFeedMaterial(options: { ministryId?: string; limit?: number } = {}): Promise<{
  flags: PublishedFlag[];
  evidence: EvidenceItem[];
}> {
  const limit = options.limit ?? 30;
  try {
    const [flags, evidence] = await Promise.all([
      listPublishedFlags({ limit, ...(options.ministryId ? { ministryId: options.ministryId } : {}) }),
      listPublishedEvidence({ limit, ...(options.ministryId ? { ministryId: options.ministryId } : {}) }),
    ]);
    return { flags, evidence };
  } catch (error) {
    // A feed that cannot be built is served empty rather than as a 500: feed
    // readers back off on errors, and an empty but well-formed document keeps
    // the subscription alive until the store is readable again.
    console.error('[digest] could not read the feed material', error);
    return { flags: [], evidence: [] };
  }
}
