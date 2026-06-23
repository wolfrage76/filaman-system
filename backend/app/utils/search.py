"""Shared text normalization and fuzzy search helpers."""

from __future__ import annotations

import re
from collections.abc import Iterable

FUZZY_MATCH_THRESHOLD = 0.75

_SYNONYMS: dict[str, str] = {
    "+": "plus",
}


def normalize_search_text(value: str) -> str:
    """Normalize product names for token-based fuzzy matching."""
    normalized = value.lower().strip()
    normalized = normalized.replace("+", " + ")
    normalized = re.sub(r"[()[\]{}<>]", " ", normalized)
    normalized = re.sub(r"[_,\-/]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def search_tokens(value: str) -> set[str]:
    """Tokenize normalized search text and map known synonyms."""
    return {
        _SYNONYMS.get(token, token)
        for token in normalize_search_text(value).split()
        if token
    }


def fuzzy_token_score(a: str, b: str) -> float:
    """Return a symmetric token-overlap score from 0.0 to 1.0."""
    tokens_a = search_tokens(a)
    tokens_b = search_tokens(b)
    if not tokens_a or not tokens_b:
        return 0.0

    overlap = len(tokens_a & tokens_b)
    return max(overlap / len(tokens_a), overlap / len(tokens_b))


def search_probe_terms(
    value: str,
    *,
    max_terms: int = 4,
    min_token_length: int = 2,
) -> list[str]:
    """Return bounded remote-search probe terms from a fuzzy query."""
    tokens = [
        token
        for token in normalize_search_text(value).split()
        if len(token) >= min_token_length
    ]
    words = [token for token in tokens if not token.isdigit()]
    numbers = [token for token in tokens if token.isdigit()]
    return _unique_preserving_order([*words, *numbers])[:max_terms]


def _unique_preserving_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result
