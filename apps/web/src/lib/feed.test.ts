import { describe, expect, it } from 'vitest';
import { ANOMALY_RULES, SITE_DISCLAIMER, type AnomalyFlag, type EvidenceItem } from '@nidhi/core';
import {
  ATOM_CONTENT_TYPE,
  escapeXml,
  evidenceToFeedEntry,
  feedEntryId,
  feedHeaders,
  flagToFeedEntry,
  renderAtom,
  type FeedEntry,
} from './feed';

/**
 * The feed is the one surface that leaves the site and gets republished
 * verbatim, so the two things that must never fail are asserted here rather
 * than trusted: that the XML cannot be broken or injected by hostile text, and
 * that a signal which has not cleared human review cannot become an entry.
 */

const SITE = 'https://example.test';

function makeFlag(overrides: Partial<AnomalyFlag> = {}): AnomalyFlag {
  return {
    flagId: 42,
    ruleId: 'march_rush',
    entityType: 'ministry',
    entityId: 'min-rural-development',
    entityName: 'Ministry of Rural Development',
    fy: 'FY2025',
    severity: 'notable',
    metric: { q4_share_pct: 42.5 },
    explanation: 'A larger share of the year’s expenditure fell in the closing quarter.',
    status: 'approved',
    createdAt: '2026-07-01T04:30:00.000Z',
    evidence: [],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidenceId: 7,
    kind: 'pib',
    title: 'Release on rural roads',
    url: 'https://example.test/pib/1?a=1&b=2',
    publishedDate: '2026-07-01',
    ministryId: 'min-rural-development',
    schemeId: null,
    summary: 'The release states that funds were transferred to state agencies.',
    ...overrides,
  };
}

function minimalFeed(entries: FeedEntry[]) {
  return {
    id: 'urn:nidhi-drishti:feed:test',
    title: 'Test feed',
    subtitle: SITE_DISCLAIMER,
    selfUrl: `${SITE}/feed.xml`,
    alternateUrl: `${SITE}/digest`,
    entries,
  };
}

/**
 * A deliberately small well-formedness check.
 *
 * There is no XML parser in the web app's dependencies and this module exists
 * precisely so as not to add one, so the assertion is structural: after every
 * escaped entity is removed, no bare `&`, `<` or `>` may remain inside text.
 */
function textNodesOf(xml: string): string[] {
  return xml.split(/<[^>]*>/g).filter((chunk) => chunk.trim().length > 0);
}

describe('escapeXml', () => {
  it('escapes all five predefined entities', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('escapes the ampersand first, so an escape is never double-escaped', () => {
    // The classic ordering bug: escaping < before & turns "&lt;" into "&amp;lt;".
    expect(escapeXml('a < b')).toBe('a &lt; b');
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });

  it('neutralises the CDATA terminator', () => {
    // This module never emits CDATA, which is why `]]>` needs no special case:
    // it is escaped like any other text. The assertion pins that down, because
    // a future edit that reaches for CDATA would break exactly here.
    expect(escapeXml(']]>')).toBe(']]&gt;');
  });

  it('drops characters XML 1.0 forbids even when escaped', () => {
    const withControl = `title${String.fromCharCode(0)}${String.fromCharCode(7)}text`;
    expect(escapeXml(withControl)).toBe('titletext');
    // Tab, newline and carriage return are legal and must survive.
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('leaves non-ASCII text alone', () => {
    expect(escapeXml('निधि दृष्टि')).toBe('निधि दृष्टि');
  });
});

describe('renderAtom', () => {
  it('produces a declaration and a single feed element', () => {
    const xml = renderAtom(minimalFeed([]));
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml.trimEnd().endsWith('</feed>')).toBe(true);
  });

  it('carries the site disclaimer in the channel description, whatever the caller passed', () => {
    // Escaped, because the disclaimer itself is just text like any other.
    const xml = renderAtom({ ...minimalFeed([]), subtitle: 'A subtitle with no disclaimer in it.' });
    const subtitle = /<subtitle type="text">([\s\S]*?)<\/subtitle>/.exec(xml)?.[1] ?? '';
    expect(subtitle).toContain(escapeXml(SITE_DISCLAIMER));
    expect(subtitle).toContain('A subtitle with no disclaimer in it.');
    expect(xml).toContain(`<rights type="text">${escapeXml(SITE_DISCLAIMER)}</rights>`);
  });

  it('escapes hostile text in element content and in attributes', () => {
    const xml = renderAtom(
      minimalFeed([
        {
          id: 'urn:nidhi-drishti:flag:1',
          title: '</title><script>alert(1)</script>',
          link: `${SITE}/ministry/x?a=1&b=2"onload="x`,
          updated: '2026-07-01T00:00:00.000Z',
          summary: 'Ampersands & angle < brackets > and a ]]> for good measure.',
          categories: [{ term: 'rule&id', label: 'Label "quoted"' }],
        },
      ]),
    );

    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(xml).toContain('a=1&amp;b=2&quot;onload=&quot;x');
    expect(xml).toContain('term="rule&amp;id"');
    expect(xml).toContain('label="Label &quot;quoted&quot;"');
    expect(xml).toContain(']]&gt;');
    expect(xml).not.toContain('<![CDATA[');
  });

  it('leaves no unescaped markup characters in any text node', () => {
    const xml = renderAtom(
      minimalFeed([
        {
          id: 'urn:nidhi-drishti:flag:2',
          title: 'R&D < 5% > target ]]> "quoted" \'single\'',
          link: `${SITE}/flags`,
          updated: '2026-07-01T00:00:00.000Z',
          summary: '<b>not markup</b> & not an entity',
        },
      ]),
    );
    for (const node of textNodesOf(xml)) {
      expect(node).not.toMatch(/[<>]/);
      // A bare ampersand is one not starting a known entity.
      expect(node).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
    }
  });

  it('timestamps the feed from the newest entry, not from the request', () => {
    const xml = renderAtom(
      minimalFeed([
        {
          id: 'a',
          title: 'older',
          link: SITE,
          updated: '2026-06-01T00:00:00.000Z',
          summary: 'older',
        },
        {
          id: 'b',
          title: 'newer',
          link: SITE,
          updated: '2026-06-09T00:00:00.000Z',
          summary: 'newer',
        },
      ]),
    );
    expect(xml).toContain('<updated>2026-06-09T00:00:00.000Z</updated>');
  });
});

describe('flagToFeedEntry', () => {
  it('refuses a signal that has not cleared review', () => {
    // docs/05 A3. This is the second of two gates; the query is the first.
    expect(flagToFeedEntry(makeFlag({ status: 'pending' }), SITE)).toBeNull();
    expect(flagToFeedEntry(makeFlag({ status: 'rejected' }), SITE)).toBeNull();
  });

  it('builds an entry for an approved signal', () => {
    const entry = flagToFeedEntry(makeFlag(), SITE);
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe('urn:nidhi-drishti:flag:42');
  });

  it('carries the rule label, the entity, the year and the explanation', () => {
    const flag = makeFlag();
    const entry = flagToFeedEntry(flag, SITE);
    const rule = ANOMALY_RULES[flag.ruleId];
    expect(entry?.title).toContain(rule.label);
    expect(entry?.title).toContain(flag.entityName);
    expect(entry?.summary).toContain(flag.entityName);
    expect(entry?.summary).toContain('FY2025');
    expect(entry?.summary).toContain(flag.explanation);
  });

  it('always carries the line stating what the signal does not establish', () => {
    // The credibility armour of docs/08. An entry is quoted with no page around
    // it, so losing this line would publish an accusation we did not make.
    for (const ruleId of Object.keys(ANOMALY_RULES) as Array<AnomalyFlag['ruleId']>) {
      const entry = flagToFeedEntry(makeFlag({ ruleId }), SITE);
      expect(entry?.summary).toContain(ANOMALY_RULES[ruleId].doesNotProve);
    }
  });

  it('links back to the canonical page for the entity and year', () => {
    expect(flagToFeedEntry(makeFlag(), SITE)?.link).toBe(
      `${SITE}/ministry/min-rural-development?fy=FY2025`,
    );
    expect(
      flagToFeedEntry(makeFlag({ entityType: 'scheme', entityId: 'sch-pmay-urban' }), SITE)?.link,
    ).toBe(`${SITE}/scheme/sch-pmay-urban?fy=FY2025`);
    expect(flagToFeedEntry(makeFlag({ entityType: 'national', entityId: 'india' }), SITE)?.link).toBe(
      `${SITE}/flags?fy=FY2025`,
    );
  });

  it('keeps its identity when the site moves', () => {
    // The id is a URN, so a domain change does not re-notify every reader.
    const here = flagToFeedEntry(makeFlag(), SITE);
    const there = flagToFeedEntry(makeFlag(), 'https://somewhere.else');
    expect(here?.id).toBe(there?.id);
    expect(here?.link).not.toBe(there?.link);
  });

  it('survives an explanation full of markup characters', () => {
    const flag = makeFlag({ explanation: 'Spend & release <b>differ</b> by > 30% ]]>' });
    const xml = renderAtom(minimalFeed([flagToFeedEntry(flag, SITE)!]));
    for (const node of textNodesOf(xml)) {
      expect(node).not.toMatch(/[<>]/);
    }
  });
});

describe('evidenceToFeedEntry', () => {
  it('refuses an item with no written summary', () => {
    expect(evidenceToFeedEntry(makeEvidence({ summary: null }), SITE)).toBeNull();
    expect(evidenceToFeedEntry(makeEvidence({ summary: '   ' }), SITE)).toBeNull();
  });

  it('carries the tier two caveat and the source link', () => {
    const entry = evidenceToFeedEntry(makeEvidence(), SITE);
    expect(entry?.summary).toContain('never a source of the figures');
    expect(entry?.summary).toContain('https://example.test/pib/1?a=1&b=2');
    expect(entry?.id).toBe(feedEntryId('evidence', 7));
  });

  it('escapes a source URL carrying query parameters', () => {
    const xml = renderAtom(minimalFeed([evidenceToFeedEntry(makeEvidence(), SITE)!]));
    expect(xml).toContain('a=1&amp;b=2');
    expect(xml).not.toMatch(/a=1&b=2/);
  });
});

describe('feedHeaders', () => {
  it('declares Atom with an explicit charset', () => {
    expect(feedHeaders()['Content-Type']).toBe(ATOM_CONTENT_TYPE);
    expect(ATOM_CONTENT_TYPE).toContain('application/atom+xml');
    expect(ATOM_CONTENT_TYPE).toContain('charset=utf-8');
  });

  it('keeps the charset out of the in-document link type, which takes no parameters', () => {
    const xml = renderAtom(minimalFeed([]));
    expect(xml).toContain('<link rel="self" type="application/atom+xml"');
    expect(xml).not.toContain('type="application/atom+xml; charset=utf-8"');
  });

  it('caches at the shared edge without pinning a reader to a stale copy', () => {
    const cache = feedHeaders()['Cache-Control'];
    expect(cache).toContain('public');
    expect(cache).toMatch(/s-maxage=\d+/);
    expect(cache).toMatch(/stale-while-revalidate=\d+/);
  });
});
