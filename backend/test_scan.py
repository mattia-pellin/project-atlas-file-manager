"""Tests for `/api/scan`'s three outcomes for a directory that yields no files.

`get_media_files` treats "does not exist", "is a file, not a directory" and "is an
empty directory" identically — all three just return nothing to iterate. Good enough
for the scanner itself, but the endpoint has to tell them apart: only the third one is
the "Nessun file multimediale in quella cartella" the frontend reports, and the other
two are a wrong path, which is a different problem with a different fix.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


@pytest.fixture
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "media"
    root.mkdir()
    monkeypatch.setenv("MEDIA_ROOT", str(root))
    monkeypatch.delenv("LIBRARY_ROOT", raising=False)
    return root


def test_an_empty_directory_returns_an_empty_list(media_root: Path) -> None:
    response = client.post("/api/scan", json={"directory": str(media_root)})
    assert response.status_code == 200
    assert response.json() == []


def test_a_directory_that_does_not_exist_is_refused_and_named(media_root: Path) -> None:
    missing = media_root / "Downloads" / "Completati"
    response = client.post("/api/scan", json={"directory": str(missing)})
    assert response.status_code == 400
    assert response.json()["detail"] == f"'{missing}' non esiste"


def test_a_path_that_is_a_file_is_refused_and_not_called_missing(media_root: Path) -> None:
    """It exists — saying "non esiste" here would be a second wrong message, not a fix."""
    not_a_directory = media_root / "readme.txt"
    not_a_directory.write_text("x")
    response = client.post("/api/scan", json={"directory": str(not_a_directory)})
    assert response.status_code == 400
    assert response.json()["detail"] == f"'{not_a_directory}' non è una cartella"


def test_a_path_outside_the_root_is_still_refused_before_either_new_check(media_root: Path) -> None:
    """Containment is checked first, so an escape attempt never reaches the new checks
    and is refused for what it is instead of "non esiste"."""
    response = client.post("/api/scan", json={"directory": "/etc"})
    assert response.status_code == 400
    assert "fuori dalle cartelle consentite" in response.json()["detail"]
