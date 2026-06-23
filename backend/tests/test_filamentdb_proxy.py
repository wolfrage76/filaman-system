import pytest

from app.api.v1 import filamentdb_proxy


@pytest.mark.asyncio
async def test_search_filaments_returns_direct_results_without_fallback(monkeypatch):
    calls: list[tuple[str, dict]] = []
    direct_result = {
        "items": [{"id": 1, "designation": "Matte Marine Blue"}],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }

    async def fake_proxy_get(path, params=None, *, client=None):
        calls.append((path, params or {}))
        return direct_result

    monkeypatch.setattr(filamentdb_proxy, "_proxy_get", fake_proxy_get)

    result = await filamentdb_proxy.search_filaments(
        _principal=None,
        search="Matte Marine Blue",
        manufacturer_id=42,
        manufacturer_name=None,
        material_key="PLA",
        page=1,
        page_size=20,
    )

    assert result == direct_result
    assert calls == [
        (
            "/filaments",
            {
                "page": 1,
                "page_size": 20,
                "search": "Matte Marine Blue",
                "manufacturer_id": 42,
                "material_key": "PLA",
            },
        )
    ]


@pytest.mark.asyncio
async def test_search_filaments_fuzzy_fallback_finds_punctuated_match(monkeypatch):
    calls: list[tuple[str, dict]] = []
    candidate = {
        "id": 11600,
        "designation": "Matte - Marine Blue (11600)",
        "material_key": "PLA",
        "manufacturer": {"name": "Example Filaments"},
    }

    async def fake_proxy_get(path, params=None, *, client=None):
        params = params or {}
        calls.append((path, params))
        if params.get("search") in {"marine", "blue"}:
            return {
                "items": [candidate],
                "total": 1,
                "page": 1,
                "page_size": params["page_size"],
            }
        return {
            "items": [],
            "total": 0,
            "page": params.get("page", 1),
            "page_size": params.get("page_size", 20),
        }

    monkeypatch.setattr(filamentdb_proxy, "_proxy_get", fake_proxy_get)

    result = await filamentdb_proxy.search_filaments(
        _principal=None,
        search="Matte Marine Blue",
        manufacturer_id=42,
        manufacturer_name=None,
        material_key="PLA",
        page=1,
        page_size=20,
    )

    assert result["items"] == [candidate]
    assert result["total"] == 1
    assert all(call[1].get("manufacturer_id") == 42 for call in calls)
    assert all(call[1].get("material_key") == "PLA" for call in calls)
    assert [call[1]["search"] for call in calls] == [
        "Matte Marine Blue",
        "matte",
        "marine",
        "blue",
    ]


@pytest.mark.asyncio
async def test_search_spool_profiles_fuzzy_fallback_deduplicates(monkeypatch):
    candidate = {"id": 7, "name": "Bambu - Reusable Spool"}

    async def fake_proxy_get(path, params=None, *, client=None):
        params = params or {}
        if params.get("search") in {"bambu", "reusable"}:
            return {
                "items": [candidate],
                "total": 1,
                "page": 1,
                "page_size": params["page_size"],
            }
        return {
            "items": [],
            "total": 0,
            "page": params.get("page", 1),
            "page_size": params.get("page_size", 20),
        }

    monkeypatch.setattr(filamentdb_proxy, "_proxy_get", fake_proxy_get)

    result = await filamentdb_proxy.search_spool_profiles(
        _principal=None,
        search="Bambu Reusable",
        page=1,
        page_size=20,
    )

    assert result["items"] == [candidate]
    assert result["total"] == 1


@pytest.mark.asyncio
async def test_search_filaments_fuzzy_fallback_rejects_low_overlap(monkeypatch):
    candidate = {
        "id": 99,
        "designation": "Marine Blue",
        "material_key": "PLA",
    }

    async def fake_proxy_get(path, params=None, *, client=None):
        params = params or {}
        if params.get("search") == "marine":
            return {
                "items": [candidate],
                "total": 1,
                "page": 1,
                "page_size": params["page_size"],
            }
        return {
            "items": [],
            "total": 0,
            "page": params.get("page", 1),
            "page_size": params.get("page_size", 20),
        }

    monkeypatch.setattr(filamentdb_proxy, "_proxy_get", fake_proxy_get)

    result = await filamentdb_proxy.search_filaments(
        _principal=None,
        search="Marine Crimson Chartreuse",
        manufacturer_id=None,
        manufacturer_name=None,
        material_key=None,
        page=1,
        page_size=20,
    )

    assert result["items"] == []
    assert result["total"] == 0


def test_lookup_text_caps_nested_remote_response_traversal():
    current = {"designation": "Root"}
    root = current
    for index in range(20):
        current["nested"] = {"designation": f"Nested {index}"}
        current = current["nested"]

    text = filamentdb_proxy._lookup_text(
        root,
        filamentdb_proxy._FILAMENT_LOOKUP_TEXT_KEYS,
    )

    assert "Root" in text
    assert "Nested 2" in text
    assert "Nested 3" not in text
