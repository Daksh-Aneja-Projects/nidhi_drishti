import type { Metadata } from 'next';
import { getSourceFreshness, listSourceRegistry } from '@nidhi/db';
import type { SourceFreshness, SourceRegistryEntry } from '@nidhi/core';
import { Database } from 'lucide-react';
import {
  Callout,
  Chip,
  EmptyState,
  PageHeader,
  PageShell,
  Section,
  TableScroll,
} from '@/components/layout-primitives';
import { formatAge, formatIstDate } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';

/**
 * The attribution page docs/08 section 1 requires.
 *
 * Every source is listed with the terms it is published under and, where a
 * publisher's robots file or terms sent us to a different route, the note
 * explaining which route we took and why.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: strings.sourcesPage.title,
    description: strings.sourcesPage.lede,
  };
}

async function load(): Promise<{
  registry: SourceRegistryEntry[];
  freshness: Map<string, SourceFreshness>;
}> {
  try {
    const [registry, freshness] = await Promise.all([listSourceRegistry(), getSourceFreshness()]);
    return { registry, freshness: new Map(freshness.map((item) => [item.sourceId, item])) };
  } catch (error) {
    console.error('[sources] could not read the registry', error);
    return { registry: [], freshness: new Map() };
  }
}

export default async function SourcesPage() {
  const [{ registry, freshness }, strings, locale] = await Promise.all([
    load(),
    getStrings(),
    getLocale(),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow={strings.sourcesPage.eyebrow}
        title={strings.sourcesPage.title}
        lede={strings.sourcesPage.lede}
      />

      <Section title={strings.sourcesPage.title} help={strings.sourcesPage.tierHelp}>
        {registry.length === 0 ? (
          <EmptyState
            icon={Database}
            title={strings.sourcesPage.empty}
            body={strings.sourcesPage.lede}
            action={{ href: '/methodology', label: strings.nav.methodology }}
          />
        ) : (
          <TableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{strings.sourcesPage.homepage}</th>
                  <th scope="col">{strings.sourcesPage.tier}</th>
                  <th scope="col">{strings.sourcesPage.cadence}</th>
                  <th scope="col">{strings.sourcesPage.method}</th>
                  <th scope="col">{strings.sourcesPage.format}</th>
                  <th scope="col">{strings.sourcesPage.freshness}</th>
                  <th scope="col">{strings.sourcesPage.licence}</th>
                </tr>
              </thead>
              <tbody>
                {registry.map((source) => {
                  const state = freshness.get(source.sourceId);
                  return (
                    <tr key={source.sourceId}>
                      <td>
                        <a
                          href={source.homepageUrl}
                          rel="noopener noreferrer nofollow"
                          target="_blank"
                          className="font-medium underline underline-offset-2"
                        >
                          {source.name}
                        </a>
                        {source.accessNote ? (
                          <p className="mt-1 max-w-[46ch] text-[12px] leading-snug text-[color:var(--color-ink-faint)]">
                            {strings.sourcesPage.accessNote}: {source.accessNote}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <Chip tone={source.tier === 1 ? 'seal' : 'muted'}>{source.tier}</Chip>
                      </td>
                      <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                        {source.cadence}
                      </td>
                      <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                        {source.method}
                      </td>
                      <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                        {source.format}
                      </td>
                      <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                        {state ? (
                          <>
                            <span>{formatAge(state.hoursSinceFetch, locale)}</span>
                            {state.latestDocumentDate ? (
                              <span className="block text-[12px] text-[color:var(--color-ink-faint)]">
                                {strings.freshness.asOf}{' '}
                                {formatIstDate(state.latestDocumentDate, locale)}
                              </span>
                            ) : null}
                            {state.isStale ? (
                              <span className="mt-1 inline-block">
                                <Chip tone="seal">{strings.freshness.stale}</Chip>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          strings.freshness.never
                        )}
                      </td>
                      <td className="max-w-[40ch] text-[12.5px] leading-snug text-[color:var(--color-ink-soft)]">
                        {source.licenseNote}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}

        <div className="mt-6">
          <Callout title={strings.sourcesPage.licence}>
            <p>{strings.sourcesPage.licenceNote}</p>
          </Callout>
        </div>
      </Section>
    </PageShell>
  );
}
