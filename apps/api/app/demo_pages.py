"""P-15: the SAMPLE enterprise pages at /demo/* (SPEC 3.5 Work Context Mode, BUILD_TASKS P-15).

Roopesh's fictional Contoso documents (engine/fixtures/sample_docs) served as plain pages, so the
demo can add them to Work Context from the right-click menu. No login, no data of anyone's: every
page starts with the SAMPLE banner that is already the first line of each file.
"""

from __future__ import annotations

from html import escape
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.errors import not_found

DOCS = Path(__file__).resolve().parent / "engine" / "fixtures" / "sample_docs"
SKIP = {"README.md", "EXPECTED.json"}

router = APIRouter(prefix="/demo", tags=["demo"])


def names() -> list[str]:
    return sorted(p.name for p in DOCS.iterdir() if p.suffix in {".md", ".vtt"} and p.name not in SKIP)


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(f"<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>{escape(title)}</title>"
                        f"<main>{body}</main></html>", headers={"Cache-Control": "no-store"})


@router.get("", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    items = "".join(f'<li><a href="/demo/{escape(n)}">{escape(n)}</a></li>' for n in names())
    return _page("SAMPLE documents - TabForest demo",
                 f"<h1>SAMPLE documents</h1><p>Fictional data for the TabForest demo.</p><ul>{items}</ul>")


@router.get("/{name}", response_class=HTMLResponse)
async def document(name: str) -> HTMLResponse:
    if name not in names():      # exact match against the folder listing: no path can escape it
        raise not_found("Page not found")
    text = (DOCS / name).read_text(encoding="utf-8")
    style = "white-space:pre-wrap;font:15px/1.5 system-ui;max-width:760px;margin:2rem auto"
    return _page(f"SAMPLE - {name}", f'<article><pre style="{style}">{escape(text)}</pre></article>')
