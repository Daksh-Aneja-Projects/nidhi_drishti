"""A6 - the daily digest (docs/05 A6).

Pure assembly. It reads flags a human has already **approved** and evidence items
whose summaries already exist, and arranges them. It makes no model call, which
is not an oversight: docs/05 says "no new claims", and the most reliable way to
make no new claims is to have nothing in the pipeline capable of making one.

Every string in the output is either a constant defined here or a value read from
a row that a person signed off on.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import structlog

from agents.lib.db import GuardedConnection, fetch_all
from agents.lib.prompts import find_banned_vocabulary

log = structlog.get_logger(__name__)

AGENT_ID = "A6"

#: The banner docs/08 section 3 requires on anything we publish.
DISCLAIMER = (
    "Nidhi Drishti is an independent transparency project. It is not affiliated with the "
    "Government of India. All figures are compiled from cited public sources and may be "
    "provisional or revised. AI-assembled analyses are labeled and cite their sources."
)

SEVERITY_ORDER = {"high": 0, "notable": 1, "info": 2}

APPROVED_FLAGS_SQL = """
SELECT f.flag_id,
       f.rule_id,
       f.entity_type,
       f.entity_id,
       f.fy,
       f.severity,
       f.metric,
       f.explanation,
       f.reviewed_at,
       COALESCE(m.name, s.name, f.entity_id) AS entity_label
  FROM anomaly_flag f
  LEFT JOIN ministry m ON f.entity_type = 'ministry' AND m.ministry_id = f.entity_id
  LEFT JOIN scheme   s ON f.entity_type = 'scheme'   AND s.scheme_id  = f.entity_id
 WHERE f.status = 'approved'
   AND f.reviewed_at >= %(since)s
 ORDER BY f.reviewed_at DESC
 LIMIT %(limit)s
"""

NOTABLE_EVIDENCE_SQL = """
SELECT e.evidence_id, e.kind, e.title, e.url, e.published_date, e.summary,
       COALESCE(m.name, s.name) AS entity_label
  FROM evidence_item e
  LEFT JOIN ministry m ON m.ministry_id = e.ministry_id
  LEFT JOIN scheme   s ON s.scheme_id  = e.scheme_id
 WHERE e.summary IS NOT NULL
   AND e.published_date >= %(since)s
 ORDER BY e.published_date DESC
 LIMIT %(limit)s
"""


@dataclass(frozen=True, slots=True)
class Digest:
    """One digest edition."""

    generated_for: date
    flags: tuple[dict[str, Any], ...]
    evidence: tuple[dict[str, Any], ...]

    @property
    def is_empty(self) -> bool:
        return not self.flags and not self.evidence

    def to_markdown(self, *, site_url: str = "") -> str:
        """Render the edition. Every fact here came from an approved row."""
        lines = [f"# Budget transparency digest, {self.generated_for.isoformat()}", ""]

        if self.is_empty:
            lines.append(
                "No flags were approved and no new evidence was summarised in this period. "
                "Nothing is being reported today."
            )
            lines.extend(["", "---", "", DISCLAIMER])
            return "\n".join(lines)

        if self.flags:
            lines.append("## Newly approved flags")
            lines.append("")
            for flag in self.flags:
                lines.append(
                    f"### {flag['entity_label']} ({flag['fy']}), {flag['rule_id']}, "
                    f"{flag['severity']}"
                )
                lines.append("")
                lines.append(str(flag["explanation"]).strip())
                does_not_show = (flag.get("metric") or {}).get("does_not_show")
                if does_not_show:
                    lines.append("")
                    lines.append(f"What this does not show: {does_not_show}")
                if site_url:
                    lines.append("")
                    lines.append(
                        f"[Open on the site]({site_url.rstrip('/')}/"
                        f"{flag['entity_type']}/{flag['entity_id']}?fy={flag['fy']})"
                    )
                lines.append("")

        if self.evidence:
            lines.append("## Recent evidence")
            lines.append("")
            for item in self.evidence:
                published = (
                    item["published_date"].isoformat()
                    if isinstance(item.get("published_date"), date)
                    else str(item.get("published_date") or "undated")
                )
                label = f" ({item['entity_label']})" if item.get("entity_label") else ""
                lines.append(f"- **{item['title']}**{label}, {item['kind']}, {published}")
                if item.get("summary"):
                    lines.append(f"  {item['summary']}")
                if item.get("url"):
                    lines.append(f"  {item['url']}")
            lines.append("")

        lines.extend(["---", "", DISCLAIMER])
        return "\n".join(lines)


class DigestAgent:
    """docs/05 A6. Assembly only; it cannot state anything nobody approved."""

    def __init__(self, conn: GuardedConnection) -> None:
        self.conn = conn

    def build(
        self,
        *,
        since: date,
        generated_for: date | None = None,
        flag_limit: int = 25,
        evidence_limit: int = 25,
    ) -> Digest:
        flags = fetch_all(self.conn, APPROVED_FLAGS_SQL, {"since": since, "limit": flag_limit})
        evidence = fetch_all(
            self.conn, NOTABLE_EVIDENCE_SQL, {"since": since, "limit": evidence_limit}
        )
        flags.sort(
            key=lambda row: (SEVERITY_ORDER.get(str(row["severity"]), 9), str(row["entity_label"]))
        )

        # Last line of defence. An approved flag has been through a human, but a
        # digest goes out by email and is the least reversible surface we have.
        clean_flags = []
        for flag in flags:
            banned = find_banned_vocabulary(str(flag["explanation"]))
            if banned:
                log.error(
                    "a6.flag_excluded_banned_vocabulary",
                    flag_id=flag["flag_id"],
                    terms=banned,
                )
                continue
            clean_flags.append(flag)

        digest = Digest(
            generated_for=generated_for or date.today(),
            flags=tuple(clean_flags),
            evidence=tuple(evidence),
        )
        log.info(
            "a6.digest_built",
            flags=len(digest.flags),
            evidence=len(digest.evidence),
            since=since.isoformat(),
        )
        return digest
