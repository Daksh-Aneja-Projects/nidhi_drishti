/**
 * Run the docs/04 invariant checks and print the findings.
 *
 * Exits non-zero only on `error` severity. A `warn` is a real-world condition
 * that must be visible and explained (a CGA revision, a residual between
 * ministry and national totals), not a build failure, so it prints and passes.
 */

import { closePool, query } from '../client';

interface Finding {
  invariant: string;
  severity: string;
  fy: string | null;
  entity_id: string | null;
  detail: string;
}

const targetFy = process.argv[2] ?? null;

query<Finding>('SELECT * FROM check_invariants($1) ORDER BY severity, invariant', [targetFy])
  .then((findings) => {
    const errors = findings.filter((f) => f.severity === 'error');
    const warnings = findings.filter((f) => f.severity === 'warn');
    const infos = findings.filter((f) => f.severity === 'info');

    for (const group of [errors, warnings, infos]) {
      for (const finding of group) {
        const scope = [finding.fy, finding.entity_id].filter(Boolean).join(' ');
        console.log(
          `[${finding.severity.toUpperCase()}] ${finding.invariant}${scope ? ` (${scope})` : ''}\n    ${finding.detail}`,
        );
      }
    }

    console.log(
      `\n${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} note(s).`,
    );
    if (errors.length > 0) process.exitCode = 1;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
