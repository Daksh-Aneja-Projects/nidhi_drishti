import { describe, expect, it } from 'vitest';
import { strings } from './strings';
import { strings as stringsHi } from './strings.hi';

/**
 * The copy rules in CLAUDE.md and docs/06 are easy to state and easy to break
 * during a hurried edit, so they are asserted rather than trusted. Every rule
 * here maps to a line in the docs.
 *
 * The house rules apply to the Hindi dictionary as well: an em-dash, an emoji or
 * a version reference is a bug in either language. The generic rules therefore
 * run against both dictionaries. The sentence-case rule is the one exception,
 * and it is excluded from Hindi deliberately: Devanagari has no upper and lower
 * case, so there is nothing for the check to test.
 */

function collectStrings(value: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof value === 'string') return [[path.join('.'), value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => collectStrings(child, [...path, key]));
  }
  return [];
}

/**
 * The set of dotted key paths in a dictionary, arrays included by index so a
 * translation that dropped or added an array item is caught too.
 */
function keyPaths(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => keyPaths(child, [...path, String(index)]));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => keyPaths(child, [...path, key]));
  }
  return [path.join('.')];
}

const dictionaries = [
  ['en', strings],
  ['hi', stringsHi],
] as const;

describe.each(dictionaries)('user-facing copy (%s)', (_locale, dict) => {
  const allStrings = collectStrings(dict);

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
    // Devanagari (U+0900..U+097F) sits well outside these ranges.
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

  it('carries the "what this does not establish" line for signals', () => {
    expect(dict.flags.doesNotProve).toBeTruthy();
  });

  it('labels AI assembled output as such', () => {
    expect(dict.verification.aiLabel).toBeTruthy();
  });
});

describe('English copy specifics', () => {
  const allStrings = collectStrings(strings);

  it('explains that a missing figure is not a zero', () => {
    expect(strings.common.notReported).toBe('Not reported');
    expect(strings.common.notReportedHelp).toContain('not zero');
  });

  it('labels AI assembled output with the English terms', () => {
    expect(strings.verification.aiLabel.toLowerCase()).toContain('ai');
    expect(strings.verification.aiLabel.toLowerCase()).toContain('cited');
  });

  it('keeps labels in sentence case rather than title case', () => {
    // Title case creeps into short labels. A word is suspect when it starts a
    // capital, is not the first word of its sentence, and is not a proper noun.
    //
    // This rule is English only. Devanagari has no letter case, so it is
    // excluded from the Hindi dictionary deliberately rather than by omission:
    // there is nothing here for the check to test in Hindi.
    const properNouns = ['CSV', 'API', 'AI', 'India', 'Nidhi', 'Drishti', 'Hindi'];
    const labels = [...Object.entries(strings.nav), ...Object.entries(strings.common)];

    const offenders = labels.filter(([, text]) =>
      typeof text === 'string' &&
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

  it('has more than a token amount of copy', () => {
    expect(allStrings.length).toBeGreaterThan(50);
  });
});

describe('the two dictionaries stay in lockstep', () => {
  it('have exactly the same key structure', () => {
    // A missing translation must be a build failure, not an English string
    // surfacing mid page in a Hindi session. The compile-time annotation on
    // strings.hi.ts already enforces the shape; this asserts it at run time too,
    // arrays included, so a dropped list item is caught as well.
    const enPaths = keyPaths(strings).sort();
    const hiPaths = keyPaths(stringsHi).sort();

    const missingInHi = enPaths.filter((path) => !hiPaths.includes(path));
    const extraInHi = hiPaths.filter((path) => !enPaths.includes(path));

    expect(missingInHi).toEqual([]);
    expect(extraInHi).toEqual([]);
  });
});
