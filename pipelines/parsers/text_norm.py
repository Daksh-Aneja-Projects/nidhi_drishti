"""Organisation name normalisation for entity matching.

The same ministry is spelled a dozen ways across sources. A CPPP tender says
"Ministry of Jal Shakti, Dept of Drinking Water & Sanitation"; the budget
document says "Department of Drinking Water and Sanitation"; a PIB release says
"M/o Jal Shakti". Matching them is what makes "money released" line up with
"tenders floated" at all.

Normalisation here is deliberately conservative. It folds spelling and
punctuation, never meaning: "Department of Higher Education" and "Department of
School Education and Literacy" stay distinct, because merging them would move
crores between two real budget lines. Anything the exact and token paths cannot
settle goes to ``alias_review_queue`` for a human, never to a guess.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Sequence
from typing import Final

#: Abbreviations these portals use interchangeably with their expansions.
_ABBREVIATIONS: Final[dict[str, str]] = {
    "m/o": "ministry of",
    "d/o": "department of",
    "dept": "department",
    "deptt": "department",
    "min": "ministry",
    "govt": "government",
    "goi": "government of india",
    "&": "and",
    "dev": "development",
    "devt": "development",
    "corpn": "corporation",
    "corp": "corporation",
    "ltd": "limited",
    "pvt": "private",
    "natl": "national",
    "nat": "national",
    "auth": "authority",
    "comm": "commission",
    "org": "organisation",
    "affrs": "affairs",
    "edn": "education",
    "engg": "engineering",
    "admn": "administration",
}

#: Words that carry no distinguishing information in an Indian government
#: organisation name. Removed only for the *token set* form used in fuzzy
#: comparison; the normalised form keeps them so a display string stays honest.
_NOISE_TOKENS: Final[frozenset[str]] = frozenset(
    {
        "the",
        "of",
        "for",
        "and",
        "india",
        "indian",
        "government",
        "govt",
        "goi",
        "republic",
        "union",
        "central",
        "office",
        "o",
    }
)

#: British and American spellings that appear in the same document set.
_SPELLING: Final[dict[str, str]] = {
    "organization": "organisation",
    "organizations": "organisations",
    "utilization": "utilisation",
    "labor": "labour",
    "defense": "defence",
    "programme": "program",
    "programmes": "programs",
    "centre": "center",
}

_PUNCTUATION: Final = re.compile(r"[^\w\s/&]")
_WHITESPACE: Final = re.compile(r"\s+")


def strip_accents(text: str) -> str:
    """Fold accented Latin characters. Devanagari is left intact."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalise_org_name(name: str) -> str:
    """Canonical comparison form of an organisation name.

    Lowercased, accent-folded, punctuation-stripped, abbreviations expanded,
    spelling harmonised, whitespace collapsed. Two strings with the same
    normalised form are the same organisation as far as the exact matcher is
    concerned.
    """
    if not name:
        return ""
    text = strip_accents(str(name)).lower()
    # Slash forms have to be expanded before punctuation is stripped, or "m/o"
    # becomes "mo" and stops meaning "ministry of".
    for abbreviation, expansion in _ABBREVIATIONS.items():
        if "/" in abbreviation or abbreviation == "&":
            text = re.sub(rf"(?<!\w){re.escape(abbreviation)}(?!\w)", f" {expansion} ", text)
    text = _PUNCTUATION.sub(" ", text)
    text = text.replace("/", " ").replace("&", " and ")

    tokens = []
    for token in text.split():
        expanded = _ABBREVIATIONS.get(token, token)
        expanded = _SPELLING.get(expanded, expanded)
        tokens.extend(expanded.split())

    return _WHITESPACE.sub(" ", " ".join(tokens)).strip()


def token_set(name: str) -> frozenset[str]:
    """Distinguishing tokens of a name, for fuzzy comparison.

    Noise words are dropped here and only here. "Ministry of Health and Family
    Welfare" and "Health and Family Welfare" reduce to the same token set, which
    is correct, while "Higher Education" and "School Education" do not.
    """
    return frozenset(token for token in normalise_org_name(name).split() if token not in _NOISE_TOKENS)


def token_overlap(left: str, right: str) -> float:
    """Jaccard similarity of two names' token sets, 0..1.

    Used only to *propose* an alias for human review. Nothing in this module
    writes an alias on the strength of a similarity score alone: db/migrations
    records ``resolved_by`` precisely so a machine guess is never mistaken for a
    verified mapping.
    """
    a, b = token_set(left), token_set(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def best_matches(
    name: str,
    candidates: Iterable[tuple[str, str]],
    *,
    limit: int = 5,
    minimum: float = 0.34,
) -> list[tuple[str, str, float]]:
    """Rank candidates for ``name`` as ``(entity_id, candidate_name, score)``.

    Returned for the review queue's ``suggestions`` column. The caller decides
    what to do with them, and for anything below a hand-set confidence the
    answer is "ask a person".
    """
    scored = [
        (entity_id, candidate, token_overlap(name, candidate))
        for entity_id, candidate in candidates
    ]
    scored = [item for item in scored if item[2] >= minimum]
    scored.sort(key=lambda item: (-item[2], item[1]))
    return scored[:limit]


def slugify(name: str, prefix: str) -> str:
    """Build a stable id such as ``min-jal-shakti`` or ``sch-pm-kisan``.

    The shape is enforced by CHECK constraints in db/migrations/0002, so this
    produces exactly what those constraints accept.
    """
    base = normalise_org_name(name)
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    if not base:
        raise ValueError(f"Cannot build an id from {name!r}: nothing usable is left after folding.")
    return f"{prefix}-{base}"


def ministry_id(name: str) -> str:
    return slugify(name, "min")


def scheme_id(name: str) -> str:
    return slugify(name, "sch")


def clean_cell(value: object) -> str:
    """Collapse whitespace and strip a cell, keeping its characters intact.

    PDF extraction leaves hard line breaks inside a single logical cell, so this
    runs on essentially every string that comes out of a document.
    """
    if value is None:
        return ""
    return _WHITESPACE.sub(" ", str(value).replace("\xa0", " ")).strip()


def dedupe_preserving_order(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result
