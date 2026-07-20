"""The deterministic rendering used when a narrative cannot be verified.

docs/05 A4 step 5: on a second self-check failure, fall back to a template
rendering of the raw facts. This module is that template.

It is intentionally plain. It states the figures with their stages, lists the
observable activity, and says where the record is silent. There is no analysis
because there is nothing here that could produce one, which is exactly the
property that makes it safe: a page rendered from this file cannot contain a
number that is not in the fact bundle, because every number it prints is read
straight out of one.
"""

from __future__ import annotations

from agents.a4_verification.facts import FactBundle
from agents.lib.format import crore

STAGE_LABELS = {
    "BE": "Budget Estimate",
    "RE": "Revised Estimate",
    "SUPPLEMENTARY": "Supplementary grant",
    "SANCTION": "Sanctioned",
    "RELEASE": "Released",
    "EXPENDITURE": "Expenditure",
    "UTILIZATION": "Utilization reported",
}


def render_fallback(bundle: FactBundle) -> str:
    """Markdown assembled mechanically from the facts."""
    parts: list[str] = ["## Reported"]

    if not bundle.fiscal_facts:
        parts.append(
            "No figures for this entity and financial year are recorded in the sources "
            "indexed here. No evidence found does not mean no money moved: it means this "
            "project has not ingested a document that reports it."
        )
    else:
        for line in bundle.fiscal_facts:
            label = STAGE_LABELS.get(line.stage, line.stage)
            period = ""
            if line.period_end is not None:
                qualifier = "cumulative to" if line.is_cumulative else "for the period ending"
                period = f", {qualifier} {line.period_end.isoformat()}"
            provisional = ", provisional" if line.is_provisional else ""
            parts.append(
                f"- {label} ({line.head}): {crore(line.amount_inr_cr)}{period}{provisional} "
                f"[source:{line.source_record_id}]"
            )
        if bundle.derived:
            parts.append("")
            for label, value in bundle.derived.items():
                parts.append(f"- {label}: {value}")

    parts.append("")
    parts.append("## Observable activity")
    if bundle.tenders:
        for tender in bundle.tenders:
            tender_value = crore(tender.value_inr_cr)
            published = (
                tender.published_date.isoformat() if tender.published_date else "date not published"
            )
            parts.append(
                f"- {tender.title} ({tender.status}, {tender_value}, published {published}) "
                f"[tender:{tender.tender_id}]"
            )
    else:
        parts.append(
            "No matching tenders were found in the central procurement portal for this "
            "entity and year. The portal does not carry every contract, so this is a gap in "
            "the observable record rather than a statement about procurement."
        )

    if bundle.evidence:
        parts.append("")
        for item in bundle.evidence:
            published = item.published_date.isoformat() if item.published_date else "undated"
            parts.append(f"- {item.kind}, {published}: {item.title} [evidence:{item.evidence_id}]")

    parts.append("")
    parts.append("## What is not in the record")
    parts.append(
        "This rendering lists the figures and items on file and draws no conclusions from "
        "them. An automated analysis was attempted and did not pass its own verification "
        "check, so the raw record is shown instead."
    )
    if bundle.as_of is not None:
        parts.append(
            f"The most recent figure covers a period ending {bundle.as_of.isoformat()}. "
            "Central accounts run roughly two months behind, so activity after that date is "
            "not reflected above."
        )
    if not bundle.evidence:
        parts.append(
            "No press releases, news items or parliament answers for this entity and year "
            "were indexed, so no evidence found here speaks to what the money did."
        )

    return "\n".join(parts)
