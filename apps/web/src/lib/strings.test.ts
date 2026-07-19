import { describe, expect, it } from 'vitest';
import { strings } from './strings';

/**
 * The copy rules in CLAUDE.md and docs/06 are easy to state and easy to break
 * during a hurried edit, so they are asserted rather than trusted. Every rule
 * here maps to a line in the docs.
 */

function collectStrings(value: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof value === 'string') return [[path.join('.'), value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => collectStrings(child, [...path, key]));
  }
  return [];
}

const allStrings = collectStrings(strings);

describe('user-facing copy', () => {
  it('has strings to check', () => {
    expect(allStrings.length).toBeGreaterThan(50);
  });

  it('contains no em-dashes or en-dashes', () => {
    // CLAUDE.md: use commas, full stops, or restructure the sentence.
    const offenders = allStrings.filter(([, text]) => /[—–]/.test(text));
    expect(offenders).toEqual([]);
  });

  it('contains no emoji', () => {
    // docs/06 rule 1: premium SVG icons only, emoji banned in every surface.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    const offenders = allStrings.filter(([, text]) => emoji.test(text));
    expect(offenders).toEqual([]);
  });

  it('contains no version references', () => {
    // docs/06 rule 4: freshness is communicated by data dates, not by product
    // versions. "beta", "v1", build strings and changelog badges are all out.
    const versionish = /\b(v\d|version \d|beta|alpha|release candidate|build \d)\b/i;
    const offenders = allStrings.filter(([, text]) => versionish.test(text));
    expect(offenders).toEqual([]);
  });

  it('contains none of the accusatory words banned for flag copy', () => {
    // docs/08 section 2. We publish data and methodology, not accusations.
    const banned = ['scam', 'fraud', 'siphon', 'corrupt', 'loot', 'embezzl'];
    const offenders = allStrings.filter(([, text]) =>
      banned.some((word) => text.toLowerCase().includes(word)),
    );
    expect(offenders).toEqual([]);
  });

  it('never implies a live treasury feed', () => {
    // docs/03 honest limitations: "live" means as fresh as the sources allow.
    // Claiming real time would be the single most damaging overstatement the
    // product could make.
    const overclaim = /\b(real ?time|live feed|up to the minute|treasury feed)\b/i;
    const offenders = allStrings.filter(([, text]) => overclaim.test(text));
    expect(offenders).toEqual([]);
  });

  it('explains that a missing figure is not a zero', () => {
    expect(strings.common.notReported).toBe('Not reported');
    expect(strings.common.notReportedHelp).toContain('not zero');
  });

  it('labels AI assembled output as such', () => {
    expect(strings.verification.aiLabel.toLowerCase()).toContain('ai');
    expect(strings.verification.aiLabel.toLowerCase()).toContain('cited');
  });

  it('carries the "what this does not establish" line for signals', () => {
    expect(strings.flags.doesNotProve).toBeTruthy();
  });

  it('keeps labels in sentence case rather than title case', () => {
    // Title case creeps into short labels. A word is suspect when it starts a
    // capital, is not the first word of its sentence, and is not a proper noun.
    //
    // Sentences are split first: a capital after a full stop is correct
    // sentence case, not a title-case slip. Help text in these groups is prose
    // and legitimately runs to several sentences.
    const properNouns = ['CSV', 'API', 'AI', 'India', 'Nidhi', 'Drishti', 'Hindi'];
    const labels = [...Object.entries(strings.nav), ...Object.entries(strings.common)];

    const offenders = labels.filter(([, text]) =>
      text
        .split(/(?<=[.:?!])\s+/)
        .some((sentence) =>
          sentence
            .trim()
            .split(/\s+/)
            .slice(1)
            .some(
              (word) => /^[A-Z]/.test(word) && !properNouns.some((noun) => word.startsWith(noun)),
            ),
        ),
    );
    expect(offenders).toEqual([]);
  });
});
