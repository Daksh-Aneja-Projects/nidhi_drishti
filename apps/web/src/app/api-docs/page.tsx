import type { Metadata } from 'next';
import { PageHeader, PageShell, Section, TableScroll, Callout } from '@/components/layout-primitives';
import { strings } from '@/lib/strings';
import { siteUrl } from '@/lib/site';

/**
 * The public API reference.
 *
 * Endpoint paths live in this module rather than in the string dictionary: they
 * are identifiers of a machine interface, not copy, and the dictionary asserts
 * against strings that look like version references, which every path here is.
 */

export const metadata: Metadata = {
  title: strings.apiDocs.title,
  description: strings.apiDocs.lede,
};

interface Endpoint {
  path: string;
  purpose: string;
  params: string;
}

const ENDPOINTS: readonly Endpoint[] = [
  {
    path: '/api/v1/national',
    purpose: 'Union totals for a financial year, with the monthly expenditure series.',
    params: 'fy',
  },
  {
    path: '/api/v1/ministries',
    purpose: 'Every ministry with authority, expenditure to date, balance and pace.',
    params: 'fy, sector, order, limit',
  },
  {
    path: '/api/v1/ministries/{id}',
    purpose: 'One ministry with its monthly series, its schemes and its published signals.',
    params: 'fy',
  },
  {
    path: '/api/v1/schemes',
    purpose: 'Schemes with allocation, releases and utilisation kept as separate stages.',
    params: 'fy, ministry, type, order, limit',
  },
  {
    path: '/api/v1/schemes/{id}',
    purpose: 'One scheme with matched tenders, evidence items and published signals.',
    params: 'fy',
  },
  {
    path: '/api/v1/flags',
    purpose: 'Published signals, each with the rule that produced it and its caveat.',
    params: 'fy, rule, severity, entityType, entityId, limit',
  },
  {
    path: '/api/v1/sources',
    purpose: 'The source registry with tier, cadence, licence note and current freshness.',
    params: 'none',
  },
  {
    path: '/api/v1/export/{view}',
    purpose:
      'Spreadsheet export with a provenance preamble. Views: ministries, schemes, flags, monthly.',
    params: 'fy, entityType and entityId for the monthly view',
  },
  {
    path: '/api/health',
    purpose: 'Database, cache and freshest source age, for an uptime monitor.',
    params: 'none',
  },
];

const ENVELOPE_SAMPLE = `{
  "data": { "ministries": [ /* ... */ ] },
  "meta": {
    "fy": "FY2026",
    "generatedAt": "2026-07-20T04:30:00.000Z",
    "dataMode": "live",
    "freshness": [
      {
        "sourceId": "cga_monthly",
        "name": "CGA Monthly Accounts",
        "latestDocumentDate": "2026-05-31",
        "lastFetchedAt": "2026-07-19T21:05:00.000Z",
        "isStale": false
      }
    ],
    "disclaimer": "..."
  }
}`;

const ERROR_SAMPLE = `{
  "error": {
    "code": "invalid_fiscal_year",
    "message": "The fy parameter must be a financial year label such as FY2026, named for the year the year ends."
  }
}`;

function Code({ children }: { children: string }) {
  return (
    <pre className="table-scroll border border-[color:var(--color-rule)] bg-[color:var(--color-paper-sunk)] p-4 text-[12.5px] leading-relaxed">
      <code className="figure whitespace-pre">{children}</code>
    </pre>
  );
}

export default function ApiDocsPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow={strings.apiDocs.eyebrow}
        title={strings.apiDocs.title}
        lede={strings.apiDocs.lede}
      />

      <Section title={strings.apiDocs.baseTitle} help={strings.apiDocs.baseBody}>
        <Code>{`${siteUrl}/api/v1`}</Code>
      </Section>

      <Section title={strings.apiDocs.endpointsTitle}>
        <TableScroll>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{strings.apiDocs.endpointsPath}</th>
                <th scope="col">{strings.apiDocs.endpointsPurpose}</th>
                <th scope="col">{strings.apiDocs.endpointsParams}</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((endpoint) => (
                <tr key={endpoint.path}>
                  <td>
                    <span className="figure text-[12.5px]">{endpoint.path}</span>
                  </td>
                  <td className="max-w-[38ch] text-[13px] text-[color:var(--color-ink-soft)]">
                    {endpoint.purpose}
                  </td>
                  <td className="text-[12.5px] text-[color:var(--color-ink-faint)]">
                    {endpoint.params}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Section>

      <Section title={strings.apiDocs.envelopeTitle} help={strings.apiDocs.envelopeBody}>
        <Code>{ENVELOPE_SAMPLE}</Code>
      </Section>

      <Section title={strings.apiDocs.absenceTitle}>
        <Callout tone="caution">
          <p>{strings.apiDocs.absenceBody}</p>
        </Callout>
        <div className="mt-4 prose-civic">
          <p>{strings.apiDocs.stagesBody}</p>
        </div>
      </Section>

      <Section title={strings.apiDocs.errorsTitle} help={strings.apiDocs.errorsBody}>
        <Code>{ERROR_SAMPLE}</Code>
      </Section>

      <Section title={strings.apiDocs.rateTitle}>
        <div className="prose-civic">
          <p>{strings.apiDocs.rateBody}</p>
        </div>
      </Section>

      <Section title={strings.apiDocs.exportsTitle}>
        <div className="prose-civic">
          <p>{strings.apiDocs.exportsBody}</p>
        </div>
      </Section>

      <Section title={strings.apiDocs.healthTitle}>
        <div className="prose-civic">
          <p>{strings.apiDocs.healthBody}</p>
        </div>
      </Section>

      <Section title={strings.apiDocs.termsTitle}>
        <Callout title={strings.footer.disclaimerTitle}>
          <p>{strings.apiDocs.termsBody}</p>
        </Callout>
      </Section>
    </PageShell>
  );
}
