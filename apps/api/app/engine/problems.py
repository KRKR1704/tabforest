"""RFC 7807 problem responses for the engine's routes."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
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


def install_problem_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ProblemError, _problem_handler)
