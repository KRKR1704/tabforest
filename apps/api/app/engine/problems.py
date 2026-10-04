"""RFC 7807 problem responses for the engine's routes."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

PROBLEM_CONTENT_TYPE = "application/problem+json"


class ProblemError(HTTPException):
    """HTTPException that renders as problem JSON. Still a plain HTTPException when mounted
    in an app without install_problem_handlers()."""

    def __init__(self, status: int, title: str, detail: str, type_: str = "about:blank",
                 headers: dict[str, str] | None = None) -> None:
        super().__init__(status_code=status, detail=detail, headers=headers)
        self.title = title
        self.type_ = type_


def problem_body(status: int, title: str, detail: str, instance: str, type_: str = "about:blank",
                 **extra: Any) -> dict[str, Any]:
    return {"type": type_, "title": title, "status": status, "detail": detail, "instance": instance, **extra}


async def _problem_handler(request: Request, exc: ProblemError) -> JSONResponse:
    return JSONResponse(problem_body(exc.status_code, exc.title, str(exc.detail), request.url.path, exc.type_),
                        status_code=exc.status_code, headers=exc.headers, media_type=PROBLEM_CONTENT_TYPE)


def _validation_detail(errors: list[dict[str, Any]]) -> str:
    """Same wording as P's handler (app/errors.py), so both apps answer contracts/claims.example.json alike."""
    if any(e["type"] == "extra_forbidden" for e in errors):
        return "Request body contains fields that are not allowed"
    first = errors[0]
    path = ".".join(str(p) if not isinstance(p, int) else f"[{p}]" for p in first["loc"] if p != "body")
    return f"{path}: {first['msg']}" if path else first["msg"]


async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(problem_body(422, "Unprocessable Entity", _validation_detail(errors), request.url.path,
                                     errors=errors), status_code=422, media_type=PROBLEM_CONTENT_TYPE)


def install_problem_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ProblemError, _problem_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
