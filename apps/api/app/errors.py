"""RFC 7807 problem responses (SPEC §10) for P's routes and for R's routes when mounted (§4.4).

Every error body is {type, title, status, detail, instance} with instance = the request path;
422 adds errors[{loc, msg, type}]. Inputs are never echoed back or logged, so titles and page
text cannot leak through an error (SPEC §12).
"""

from __future__ import annotations

import logging
import re
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.db.pool import STORAGE_ERRORS

log = logging.getLogger("tabforest.errors")

PROBLEM_JSON = "application/problem+json"
RETRY_AFTER_S = "30"


class Problem(StarletteHTTPException):
    """An error with an explicit problem title (defaults to the HTTP reason phrase)."""

    def __init__(self, status: int, detail: str, *, title: str | None = None,
                 headers: dict[str, str] | None = None) -> None:
        super().__init__(status_code=status, detail=detail, headers=headers)
        self.title = title or _phrase(status)


def unauthorized(detail: str) -> Problem:
    return Problem(401, detail, headers={"WWW-Authenticate": "Bearer"})


def unavailable(detail: str) -> Problem:
    return Problem(503, detail, headers={"Retry-After": RETRY_AFTER_S})


def not_found(detail: str) -> Problem:
    return Problem(404, detail)


def _phrase(status: int) -> str:
    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return "Error"


def problem_response(request: Request, status: int, detail: str, *, title: str | None = None,
                     headers: dict[str, str] | None = None, errors: list[dict[str, Any]] | None = None,
                     type_: str = "about:blank") -> JSONResponse:
    body: dict[str, Any] = {"type": type_, "title": title or _phrase(status), "status": status,
                            "detail": detail, "instance": request.url.path}
    if errors is not None:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, headers=headers, media_type=PROBLEM_JSON)


async def _http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    # P's Problem and R's ProblemError both carry .title; R's also carries .type_.
    detail = exc.detail if isinstance(exc.detail, str) else _phrase(exc.status_code)
    return problem_response(request, exc.status_code, detail, title=getattr(exc, "title", None),
                            headers=getattr(exc, "headers", None), type_=getattr(exc, "type_", "about:blank"))


_SOURCES = ("body", "query", "path")


def _path(loc: tuple[Any, ...] | list[Any]) -> str:
    out = ""
    for i, part in enumerate(loc):
        if i == 0 and part in _SOURCES:
            continue
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def validation_detail(errors: list[dict[str, Any]]) -> str:
    if any(e["type"] == "extra_forbidden" for e in errors):
        return "Request body contains fields that are not allowed"
    first = errors[0]
    path = _path(first["loc"])
    ctx = first.get("ctx") or {}
    allowed = re.findall(r"'([^']*)'", str(ctx.get("expected", "")))
    if first["type"] == "enum" and allowed:
        return f"{path} must be one of {', '.join(allowed)}"
    if first["type"] == "literal_error" and allowed:
        return f"{path} must be {' or '.join(allowed)}"
    if first["type"] == "literal_error" and path and first["msg"].startswith("Input should be "):
        # integer literals have no quotes to pick out; wording from contracts/privacy.example.json
        return f"{path} must be {first['msg'].removeprefix('Input should be ')}"
    if "detail" in ctx:  # a custom error that states its own wording (PydanticCustomError ctx)
        return f"{path} {ctx['detail']}"
    return f"{path}: {first['msg']}" if path else first["msg"]


async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
    raw = list(exc.errors())
    errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in raw]
    return problem_response(request, 422, validation_detail(raw), errors=errors)


async def _storage_unavailable(request: Request, exc: Exception) -> JSONResponse:
    log.warning("storage unavailable on %s: %s", request.url.path, type(exc).__name__)
    return problem_response(request, 503, "Storage is temporarily unavailable",
                            headers={"Retry-After": RETRY_AFTER_S})


async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    # Class name only: exception messages can carry request data such as titles.
    log.error("unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
    return problem_response(request, 500, "Internal server error")


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception)
    app.add_exception_handler(RequestValidationError, _validation)
    for exc_type in STORAGE_ERRORS:
        app.add_exception_handler(exc_type, _storage_unavailable)
    app.add_exception_handler(Exception, _unhandled)
