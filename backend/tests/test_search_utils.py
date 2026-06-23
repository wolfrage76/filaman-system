from app.utils.search import fuzzy_token_score, search_probe_terms


def test_fuzzy_token_score_matches_punctuation_and_catalog_suffix():
    score = fuzzy_token_score("Matte Marine Blue", "Matte - Marine Blue (11600)")

    assert score == 1.0


def test_fuzzy_token_score_handles_plus_synonym():
    score = fuzzy_token_score("PLA+", "PLA Plus")

    assert score == 1.0


def test_fuzzy_token_score_rejects_unrelated_text():
    score = fuzzy_token_score("Matte Marine Blue", "Silk Crimson Red")

    assert score == 0.0


def test_search_probe_terms_prefers_words_before_numbers():
    terms = search_probe_terms("Matte Marine Blue 11600", max_terms=4)

    assert terms == ["matte", "marine", "blue", "11600"]
