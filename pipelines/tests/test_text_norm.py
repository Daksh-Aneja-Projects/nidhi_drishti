"""Organisation name normalisation tests.

The names here are the real spread of spellings across sources. The important
negative cases are at the bottom: normalisation must not merge two ministries or
two departments that are genuinely different, because that would move crores
between real budget lines.
"""

from __future__ import annotations

import pytest

from pipelines.parsers.text_norm import (
    best_matches,
    clean_cell,
    dedupe_preserving_order,
    ministry_id,
    normalise_org_name,
    scheme_id,
    token_overlap,
    token_set,
)


class TestNormalisation:
    @pytest.mark.parametrize(
        ("left", "right"),
        [
            ("Ministry of Jal Shakti", "MINISTRY OF JAL SHAKTI"),
            ("M/o Jal Shakti", "Ministry of Jal Shakti"),
            ("D/o Higher Education", "Department of Higher Education"),
            ("Dept. of Higher Education", "Department of Higher Education"),
            ("Deptt of Higher Education", "Department of Higher Education"),
            ("Health & Family Welfare", "Health and Family Welfare"),
            ("Ministry of Defence  ", "Ministry of Defence"),
            ("Ministry of Rural Development,", "Ministry of Rural Development"),
        ],
    )
    def test_spelling_variants_fold_together(self, left: str, right: str) -> None:
        assert normalise_org_name(left) == normalise_org_name(right)

    def test_british_and_american_spellings_fold(self) -> None:
        assert normalise_org_name("Labor Ministry") == normalise_org_name("Labour Ministry")

    def test_empty_input(self) -> None:
        assert normalise_org_name("") == ""


class TestDistinctionsThatMustSurvive:
    """Folding spelling is safe. Folding meaning is not."""

    @pytest.mark.parametrize(
        ("left", "right"),
        [
            ("Department of Higher Education", "Department of School Education and Literacy"),
            ("Ministry of Health and Family Welfare", "Ministry of AYUSH"),
            ("Department of Fertilizers", "Department of Chemicals and Petrochemicals"),
            ("Ministry of Coal", "Ministry of Mines"),
        ],
    )
    def test_different_organisations_stay_different(self, left: str, right: str) -> None:
        assert normalise_org_name(left) != normalise_org_name(right)
        assert token_overlap(left, right) < 0.6


class TestTokenSets:
    def test_noise_words_are_dropped_for_comparison(self) -> None:
        assert token_set("Government of India, Ministry of Coal") == token_set("Ministry of Coal")

    def test_ministry_and_department_are_kept_as_distinguishing(self) -> None:
        """A department inside a ministry is a different budget line, not a synonym."""
        assert token_set("Ministry of Jal Shakti") != token_set("Department of Jal Shakti")

    def test_overlap_is_one_for_the_same_name(self) -> None:
        assert token_overlap("Ministry of Coal", "M/o Coal") == 1.0

    def test_overlap_is_zero_for_unrelated_names(self) -> None:
        assert token_overlap("Ministry of Coal", "Department of Space") == 0.0

    def test_ranking_returns_the_closest_candidate(self) -> None:
        candidates = [
            ("min-jal-shakti", "Ministry of Jal Shakti"),
            ("min-coal", "Ministry of Coal"),
            ("min-defence", "Ministry of Defence"),
        ]
        ranked = best_matches("M/o Jal Shakti", candidates)
        assert ranked[0][0] == "min-jal-shakti"

    def test_weak_candidates_are_not_returned(self) -> None:
        assert best_matches("Ministry of Coal", [("min-space", "Department of Space")]) == []


class TestIds:
    def test_ministry_id_matches_the_check_constraint(self) -> None:
        assert ministry_id("Ministry of Jal Shakti") == "min-ministry-of-jal-shakti"
        assert ministry_id("M/o Coal") == "min-ministry-of-coal"

    def test_scheme_id_shape(self) -> None:
        assert scheme_id("PM-KISAN").startswith("sch-")

    def test_an_unusable_name_raises(self) -> None:
        with pytest.raises(ValueError, match="Cannot build an id"):
            ministry_id("###")


class TestCellCleaning:
    def test_hard_line_breaks_inside_a_cell_collapse(self) -> None:
        assert clean_cell("Ministry of\nRural\nDevelopment") == "Ministry of Rural Development"

    def test_non_breaking_spaces_collapse(self) -> None:
        assert clean_cell("6,21,940.85") == "6,21,940.85"

    def test_none_is_empty(self) -> None:
        assert clean_cell(None) == ""

    def test_dedupe_keeps_order(self) -> None:
        assert dedupe_preserving_order(["b", "a", "b", "c"]) == ["b", "a", "c"]
