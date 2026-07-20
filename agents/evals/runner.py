"""Golden-set eval harness (docs/05, "Prompt and eval discipline").

Three suites:

* **A1** extraction: does the transcription convert to the right figure in crore,
  and do the rows that should reach a human actually reach one?
* **A2** alias matching: does the resolution ladder land on the right entity, and
  does it queue rather than guess when it should?
* **A4** narrative faithfulness: does the self check catch an invented figure?

Two modes:

* ``replay`` (the default, and what CI runs) feeds each fixture's recorded model
  response through the real post-processing. It needs no API key and no network,
  so it runs on every commit and it is what protects the deterministic half of
  the layer: the unit conversion, the confidence routing, the ladder thresholds
  and the number check.
* ``live`` calls the real model, and is what you run when a prompt changes.
  Prompt edits change ``prompt_version`` by construction, so a live score is
  always attributable to an exact prompt.

Run it: ``uv run python -m agents.evals.runner`` (add ``--live`` for the API).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

from agents.a1_extraction_assist.schema import ExtractionResult, resolve_amount
from agents.a2_entity_resolution.agent import EntityResolutionAgent
from agents.a2_entity_resolution.schema import Adjudication, Candidate
from agents.a4_verification.facts import (
    EvidenceLine,
    FactBundle,
    FactLine,
    TenderLine,
    compute_derived,
)
from agents.a4_verification.self_check import deterministic_check
from agents.lib.config import ALIAS_AUTO_ACCEPT_CONFIDENCE

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


@dataclass
class CaseResult:
    case_id: str
    passed: bool
    detail: str = ""


@dataclass
class SuiteReport:
    suite: str
    results: list[CaseResult] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def score(self) -> float:
        return self.passed / self.total if self.total else 0.0

    @property
    def failures(self) -> list[CaseResult]:
        return [r for r in self.results if not r.passed]

    def render(self) -> str:
        lines = [
            f"{self.suite}: {self.passed}/{self.total} passed ({self.score * 100:.1f} percent)"
        ]
        lines.extend(f"  FAIL {r.case_id}: {r.detail}" for r in self.failures)
        return "\n".join(lines)


def load_fixture(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
    return data


# ---------------------------------------------------------------------------
# A1
# ---------------------------------------------------------------------------


def run_a1(fixture: dict[str, Any] | None = None) -> SuiteReport:
    """Score the transcription-to-crore path and the review routing."""
    data = fixture or load_fixture("a1_extraction.json")
    report = SuiteReport(suite="A1 extraction")
    for case in data["cases"]:
        expected = case["expected"]
        try:
            result = ExtractionResult.model_validate(case["model_response"])
        except Exception as exc:  # noqa: BLE001 - a schema failure is a case failure
            report.results.append(
                CaseResult(case["id"], False, f"response did not validate: {exc}")
            )
            continue

        resolved = [resolve_amount(row) for row in result.rows]
        usable = [r for r in resolved if not r.needs_review]
        review = [r for r in resolved if r.needs_review]
        amounts = [str(r.amount_inr_cr) for r in resolved if r.amount_inr_cr is not None]
        stages = [r.row.stage for r in resolved]

        problems: list[str] = []
        if len(usable) != expected["usable_count"]:
            problems.append(f"usable {len(usable)} != {expected['usable_count']}")
        if len(review) != expected["review_count"]:
            problems.append(f"needs review {len(review)} != {expected['review_count']}")
        if amounts != expected["amounts_inr_cr"]:
            problems.append(f"amounts {amounts} != {expected['amounts_inr_cr']}")
        if stages != expected["stages"]:
            problems.append(f"stages {stages} != {expected['stages']}")

        report.results.append(CaseResult(case["id"], not problems, "; ".join(problems)))
    return report


# ---------------------------------------------------------------------------
# A2
# ---------------------------------------------------------------------------


def run_a2(fixture: dict[str, Any] | None = None) -> SuiteReport:
    """Score the whole resolution ladder, including the decision to queue."""
    data = fixture or load_fixture("a2_aliases.json")
    report = SuiteReport(suite="A2 alias matching")
    for case in data["cases"]:
        candidates = [Candidate.model_validate(c) for c in case["candidates"]]
        expected = case["expected"]

        cheap = EntityResolutionAgent.deterministic_choice(case["raw_name"], candidates)
        if cheap is not None:
            entity_id: str | None = cheap.entity_id
            tier = cheap.resolved_by
        elif not candidates:
            entity_id, tier = None, "queued"
        else:
            raw = case.get("adjudication")
            if raw is None:
                report.results.append(
                    CaseResult(
                        case["id"],
                        False,
                        "case reached the adjudication tier but carries no recorded adjudication",
                    )
                )
                continue
            verdict = Adjudication.model_validate(raw)
            allowed = {c.entity_id for c in candidates}
            if (
                verdict.entity_id is None
                or verdict.entity_id not in allowed
                or verdict.confidence < ALIAS_AUTO_ACCEPT_CONFIDENCE
            ):
                entity_id, tier = None, "queued"
            else:
                entity_id, tier = verdict.entity_id, "agent"

        problems = []
        if entity_id != expected["entity_id"]:
            problems.append(f"resolved {entity_id!r} != {expected['entity_id']!r}")
        if tier != expected["expected_tier"]:
            problems.append(f"tier {tier!r} != {expected['expected_tier']!r}")
        report.results.append(CaseResult(case["id"], not problems, "; ".join(problems)))
    return report


# ---------------------------------------------------------------------------
# A4
# ---------------------------------------------------------------------------


def bundle_from_fixture(spec: dict[str, Any]) -> FactBundle:
    """Build a real :class:`FactBundle` from a fixture's facts block."""
    facts = tuple(
        FactLine(
            stage=str(item["stage"]),
            head=str(item.get("head", "total")),
            amount_inr_cr=Decimal(str(item["amount_inr_cr"])),
            source_record_id=int(item["source_record_id"]),
            document_date=_date(item.get("document_date")),
            period_start=_date(item.get("period_start")),
            period_end=_date(item.get("period_end")),
            is_cumulative=bool(item.get("is_cumulative", False)),
            is_provisional=bool(item.get("is_provisional", False)),
        )
        for item in spec.get("fiscal_facts", [])
    )
    tenders = tuple(
        TenderLine(
            tender_id=str(item["tender_id"]),
            title=str(item["title"]),
            status=str(item["status"]),
            value_inr_cr=(Decimal(str(item["value_inr_cr"])) if item.get("value_inr_cr") else None),
            published_date=_date(item.get("published_date")),
        )
        for item in spec.get("tenders", [])
    )
    evidence = tuple(
        EvidenceLine(
            evidence_id=int(item["evidence_id"]),
            kind=str(item["kind"]),
            title=str(item["title"]),
            published_date=_date(item.get("published_date")),
            summary=item.get("summary"),
        )
        for item in spec.get("evidence", [])
    )
    bundle = FactBundle(
        entity_type=spec["entity_type"],
        entity_id=spec["entity_id"],
        entity_label=spec["entity_label"],
        fy=spec["fy"],
        fiscal_facts=facts,
        tenders=tenders,
        evidence=evidence,
    )
    if spec.get("skip_derived"):
        # Used by the cases that check a computed figure is rejected when the
        # facts do not already contain it.
        return bundle
    return FactBundle(
        entity_type=bundle.entity_type,
        entity_id=bundle.entity_id,
        entity_label=bundle.entity_label,
        fy=bundle.fy,
        fiscal_facts=bundle.fiscal_facts,
        tenders=bundle.tenders,
        evidence=bundle.evidence,
        derived=compute_derived(bundle),
    )


def run_a4(fixture: dict[str, Any] | None = None) -> SuiteReport:
    """Score the deterministic half of the self check.

    Cases marked ``model_only`` are ones no regular expression can catch, such as
    a release described as expenditure. For those the deterministic pass is
    expected to *pass*, and the case is scored on that: the point is to prove
    the second, model-based pass is not redundant.
    """
    data = fixture or load_fixture("a4_narratives.json")
    report = SuiteReport(suite="A4 narrative faithfulness")
    for case in data["cases"]:
        bundle = bundle_from_fixture(case["bundle"])
        result = deterministic_check(case["narrative"], bundle)
        model_only = bool(case.get("model_only"))
        expected_pass = True if model_only else bool(case["expect_pass"])

        problems = []
        if result.passed != expected_pass:
            problems.append(
                f"deterministic check passed={result.passed}, expected {expected_pass}. "
                f"Problems: {list(result.problems)[:3]}"
            )
        needle = case.get("expected_problem_contains")
        if needle and not expected_pass and not any(needle in p for p in result.problems):
            problems.append(f"no reported problem mentions {needle!r}")
        report.results.append(CaseResult(case["id"], not problems, "; ".join(problems)))
    return report


def _date(value: Any) -> date | None:
    return None if value is None else date.fromisoformat(str(value))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run_all() -> list[SuiteReport]:
    return [run_a1(), run_a2(), run_a4()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the agent golden-set evals.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Call the real API instead of replaying recorded responses. Needs ANTHROPIC_API_KEY.",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=1.0,
        help="Exit non-zero if any suite scores below this fraction.",
    )
    args = parser.parse_args(argv)

    if args.live:
        print(
            "Live mode is not wired up in this build. The replay suites below exercise every "
            "deterministic path; a live run additionally needs an API key and a database, and "
            "should be invoked from the agent entry points directly.",
            file=sys.stderr,
        )
        return 2

    reports = run_all()
    for report in reports:
        print(report.render())
    worst = min((r.score for r in reports), default=0.0)
    return 0 if worst >= args.min_score else 1


if __name__ == "__main__":  # pragma: no cover - CLI
    raise SystemExit(main())
