/**
 * Atom serialisation for the public feeds (docs/07, the v1.1 distribution line).
 *
 * Written by hand rather than pulled from a package. A feed is a security
 * boundary: the text that goes into it is agent written and government sourced,
 * and both routinely contain `&`, `<`, and quotation marks. A dependency here
 * would be a third party sitting between an unreviewed string and the XML that
 * republishes it, for the sake of about eighty lines of escaping and templating
 * that are fully covered by `feed.test.ts`.
 *
 * Three decisions, and why:
 *
 *  1. **No CDATA anywhere.** CDATA cannot express the sequence `]]>`, so any
 *     serialiser that reaches for it needs a splitting rule, and the splitting
 *     rule is what people get wrong. Escaping every character in every position
 *     has no such edge, so it is the only mode this module has.
 *  2. **`type="text"` on every human-readable element.** The alternative,
 *     `type="html"`, means the payload is escaped once as HTML and again as XML,
 *     and a single missed layer turns a caveat into markup in someone's reader.
 *     Plain text renders everywhere and cannot be misread as markup.
 *  3. **The caveat is assembled here, not passed in.** `flagToFeedEntry` reads
 *     the "what this does not establish" line out of ANOMALY_RULES itself, the
 *     same guarantee `FlagCard` gives on screen. A feed entry is the form most
 *     likely to be quoted with no page around it, so it has to be honest alone.
 *
 * This module deliberately imports nothing from `@nidhi/db` or `next`, so it
 * stays a pure function of its inputs and is testable without either.
 */

import {
  ANOMALY_RULES,
  EVIDENCE_KIND_LABELS,
  SITE_DISCLAIMER,
  formatFiscalYearLong,
  type AnomalyFlag,
  type EvidenceItem,
} from '@nidhi/core';
// Relative rather than aliased: this module is unit tested directly, and the
// test runner resolves paths without the Next path alias.
import { strings } from './strings';

/** The bare media type. Atom's `type` attribute takes no parameters. */
export const ATOM_MEDIA_TYPE = 'application/atom+xml';

/** The HTTP header value, which does take the charset. */
export const ATOM_CONTENT_TYPE = `${ATOM_MEDIA_TYPE}; charset=utf-8`;

/**
 * Characters XML 1.0 forbids outright, even escaped.
 *
 * A parser rejects the whole document over one of these, so a single stray
 * control byte in a scraped title would take the entire feed down rather than
 * spoil one entry. They are dropped.
 */
const ILLEGAL_XML_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Escape text for use in element content or in an attribute value.
 *
 * All five predefined entities are escaped in both positions rather than the
 * minimum each position requires. Escaping `>` is not strictly necessary in
 * element content, but a value that is safe in every position cannot be moved
 * from content to an attribute later and quietly become unsafe.
 */
export function escapeXml(value: string): string {
  return value
    .replace(ILLEGAL_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 3339 timestamp, which is what Atom requires. Invalid input falls back to now. */
function atomDate(value: string | Date | null | undefined): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export interface FeedCategory {
  term: string;
  label?: string;
}

export interface FeedEntry {
  /**
   * Stable, permanent identity. Never derived from the site URL or from a
   * timestamp: a reader that has seen an entry must not see it again because
   * the deployment moved domain or the row was re-reviewed.
   */
  id: string;
  title: string;
  /** Absolute canonical URL of the page this entry summarises. */
  link: string;
  updated: string | Date;
  published?: string | Date | null;
  /** Plain text, self-contained, carrying its own caveat. */
  summary: string;
  categories?: readonly FeedCategory[];
}

export interface FeedDocument {
  /** Feed identity. Stable for the life of the feed. */
  id: string;
  title: string;
  /** The channel description. The site disclaimer belongs in here. */
  subtitle: string;
  /** Absolute URL of this feed document. */
  selfUrl: string;
  /** Absolute URL of the human-readable page this feed mirrors. */
  alternateUrl: string;
  entries: readonly FeedEntry[];
}

function tag(name: string, text: string, attributes = ''): string {
  return `<${name}${attributes}>${escapeXml(text)}</${name}>`;
}

/**
 * Serialise an Atom 1.0 document.
 *
 * `updated` on the feed is the newest entry rather than the moment of the
 * request. A feed whose timestamp moves on every fetch tells every reader that
 * everything changed, which is how a quiet day turns into a burst of duplicate
 * notifications.
 */
export function renderAtom(feed: FeedDocument): string {
  const newest = feed.entries.reduce<string | null>((latest, entry) => {
    const stamp = atomDate(entry.updated);
    return latest === null || stamp > latest ? stamp : latest;
  }, null);

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  ${tag('id', feed.id)}`,
    `  ${tag('title', feed.title, ' type="text"')}`,
    // The disclaimer is appended here rather than expected from the caller, so
    // no feed can be published without it in the place a reader looks for a
    // channel description (docs/08 section 3).
    `  ${tag('subtitle', `${feed.subtitle} ${SITE_DISCLAIMER}`, ' type="text"')}`,
    `  ${tag('updated', newest ?? new Date().toISOString())}`,
    `  <link rel="self" type="${escapeXml(ATOM_MEDIA_TYPE)}" href="${escapeXml(feed.selfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(feed.alternateUrl)}"/>`,
    // The disclaimer rides on every feed twice over: once where a reader looks
    // for a description, once where a republisher looks for terms.
    `  ${tag('rights', SITE_DISCLAIMER, ' type="text"')}`,
    `  <author>${tag('name', strings.feed.authorName)}</author>`,
  ];

  for (const entry of feed.entries) {
    lines.push('  <entry>');
    lines.push(`    ${tag('id', entry.id)}`);
    lines.push(`    ${tag('title', entry.title, ' type="text"')}`);
    lines.push(`    <link rel="alternate" type="text/html" href="${escapeXml(entry.link)}"/>`);
    lines.push(`    ${tag('updated', atomDate(entry.updated))}`);
    if (entry.published) lines.push(`    ${tag('published', atomDate(entry.published))}`);
    for (const category of entry.categories ?? []) {
      const label = category.label ? ` label="${escapeXml(category.label)}"` : '';
      lines.push(`    <category term="${escapeXml(category.term)}"${label}/>`);
    }
    lines.push(`    ${tag('summary', entry.summary, ' type="text"')}`);
    lines.push('  </entry>');
  }

  lines.push('</feed>');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Identity and links
 * ------------------------------------------------------------------ */

/**
 * Permanent entry identity, as a URN.
 *
 * A URN rather than the page URL because Atom ids must never change and a URL
 * carries the deployment's hostname, which can. `nidhi-drishti` is the fixed
 * namespace for the life of the project.
 */
export function feedEntryId(kind: 'flag' | 'evidence', id: number | string): string {
  return `urn:nidhi-drishti:${kind}:${id}`;
}

export function feedId(path: string): string {
  return `urn:nidhi-drishti:feed:${path}`;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Canonical page for a signal: the entity it is about, in the year it is about. */
export function flagPermalink(flag: Pick<AnomalyFlag, 'entityType' | 'entityId' | 'fy'>, siteUrl: string): string {
  const base = trimSlash(siteUrl);
  if (flag.entityType === 'ministry') {
    return `${base}/ministry/${encodeURIComponent(flag.entityId)}?fy=${encodeURIComponent(flag.fy)}`;
  }
  if (flag.entityType === 'scheme') {
    return `${base}/scheme/${encodeURIComponent(flag.entityId)}?fy=${encodeURIComponent(flag.fy)}`;
  }
  return `${base}/flags?fy=${encodeURIComponent(flag.fy)}`;
}

/* ------------------------------------------------------------------ *
 * Entry builders
 * ------------------------------------------------------------------ */

/**
 * Turn a signal into a feed entry, or refuse.
 *
 * Returns null for anything that has not cleared human review. The route layer
 * already asks the database for approved signals only, so this is the second of
 * two independent gates (docs/05 A3): a query that is edited carelessly still
 * cannot put a pending signal in front of a reader, because the serialiser will
 * not build the entry.
 */
export function flagToFeedEntry(
  flag: AnomalyFlag & { publishedAt?: string },
  siteUrl: string,
): FeedEntry | null {
  if (flag.status !== 'approved') return null;

  const rule = ANOMALY_RULES[flag.ruleId];
  if (!rule) return null;

  const fyLong = formatFiscalYearLong(flag.fy);
  // The national aggregate has no row in the ministry or scheme tables, so the
  // query falls back to the raw entity id. That id reads as a stray lowercase
  // word in a feed title, where there is no page around it to give it context.
  const entityLabel =
    flag.entityType === 'national' ? strings.feed.nationalEntity : flag.entityName;

  // Everything a reader needs is in the body, not only in the title. An entry
  // is read on its own, forwarded on its own, and quoted on its own.
  const summary = [
    `${rule.label}. ${entityLabel}. ${fyLong}.`,
    '',
    flag.explanation.trim(),
    '',
    `${strings.feed.doesNotEstablish}: ${rule.doesNotProve}`,
  ].join('\n');

  return {
    id: feedEntryId('flag', flag.flagId),
    title: `${rule.label}: ${entityLabel}, ${fyLong}`,
    link: flagPermalink(flag, siteUrl),
    updated: flag.publishedAt ?? flag.createdAt,
    published: flag.publishedAt ?? flag.createdAt,
    categories: [
      { term: flag.ruleId, label: rule.label },
      { term: flag.severity },
      { term: flag.fy },
    ],
    summary,
  };
}

/**
 * Turn a summarised evidence item into an entry.
 *
 * Only items that already carry a summary are eligible, which is the same test
 * A6 applies: a summary exists because it was written and kept, so the feed is
 * not reproducing a raw scrape. The tier 2 caveat is attached here for the same
 * reason the rule caveat is attached above.
 */
export function evidenceToFeedEntry(item: EvidenceItem, siteUrl: string): FeedEntry | null {
  if (!item.summary || item.summary.trim().length === 0) return null;

  const kindLabel = EVIDENCE_KIND_LABELS[item.kind] ?? item.kind;
  const base = trimSlash(siteUrl);
  // The canonical page is the entity the item is attached to. An unattached
  // item points at the digest, which is where it is actually rendered.
  const link = item.ministryId
    ? `${base}/ministry/${encodeURIComponent(item.ministryId)}`
    : item.schemeId
      ? `${base}/scheme/${encodeURIComponent(item.schemeId)}`
      : `${base}/digest`;

  const summary = [
    `${kindLabel}.`,
    '',
    item.summary.trim(),
    '',
    strings.feed.evidenceCaveat,
    ...(item.url ? ['', item.url] : []),
  ].join('\n');

  return {
    id: feedEntryId('evidence', item.evidenceId),
    title: item.title,
    link,
    // An undated item still belongs in the record. `atomDate` anchors it to the
    // moment of serialisation rather than dropping the entry.
    updated: item.publishedDate ?? new Date(),
    published: item.publishedDate,
    categories: [{ term: item.kind, label: kindLabel }],
    summary,
  };
}

/* ------------------------------------------------------------------ *
 * Response plumbing
 * ------------------------------------------------------------------ */

/**
 * Cache window for a feed.
 *
 * Feed readers poll hard and the underlying content changes only when a
 * reviewer approves something, so the shared cache holds it for ten minutes and
 * may serve it stale for longer while it revalidates. That matches the signals
 * window used by the JSON API.
 */
export const FEED_CACHE_SECONDS = 600;

export function feedHeaders(): Record<string, string> {
  return {
    'Content-Type': ATOM_CONTENT_TYPE,
    'Cache-Control': `public, max-age=300, s-maxage=${FEED_CACHE_SECONDS}, stale-while-revalidate=${FEED_CACHE_SECONDS * 4}`,
    // Feeds are fetched by machines from other origins as a matter of course.
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };
}
