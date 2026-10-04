"""Thin async wrapper over AsyncAzureOpenAI.

- chat_structured: strict json_schema Structured Outputs, parsed into a Pydantic model.
- embed: batched embeddings, order preserved.
- ContentFilteredError: Azure blocked the prompt or the completion; carries which filters
  fired so the caller can drop the input and fog that cluster (R-9, R-14).
- One retry with backoff on timeouts, connection errors, 429 and 5xx. Never on content_filter.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, TypeVar

import openai
from openai import AsyncAzureOpenAI
from pydantic import BaseModel

from .settings import EngineSettings, get_settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R")

EMBED_BATCH = 64
RETRY_BACKOFF_S = 1.0
MAX_RETRY_AFTER_S = 10.0
RETRYABLE = (openai.APITimeoutError, openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)


class AoaiNotConfiguredError(RuntimeError):
    """AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY is missing."""


class ContentFilteredError(Exception):
    """Azure's content filter blocked the request (prompt) or the completion (output)."""

    def __init__(self, filters: frozenset[str], where: str) -> None:
        self.filters = filters
        self.where = where
        super().__init__(f"content filtered ({where}): {', '.join(sorted(filters))}")


class StructuredOutputError(Exception):
    """The model refused, or the output was cut off before it parsed."""


def _fired(results: Any) -> frozenset[str]:
    """Map Azure content_filter_result(s) to {'jailbreak', 'indirect_attack', 'other'}."""
    fired: set[str] = set()
    for name, result in (results or {}).items():
        if not isinstance(result, dict):
            continue
        if result.get("filtered") or result.get("detected"):
            fired.add(name if name in ("jailbreak", "indirect_attack") else "other")
    return frozenset(fired or {"other"})


def _filters_from_error(exc: openai.BadRequestError) -> frozenset[str] | None:
    body = exc.body if isinstance(exc.body, dict) else {}
    body = body.get("error", body) if isinstance(body.get("error"), dict) else body
    if body.get("code") != "content_filter":
        return None
    inner = body.get("innererror") or {}
    return _fired(inner.get("content_filter_result"))


def _retry_after(exc: Exception) -> float:
    response = getattr(exc, "response", None)
    header = response.headers.get("retry-after") if response is not None else None
    try:
        return min(float(header), MAX_RETRY_AFTER_S) if header else RETRY_BACKOFF_S
    except ValueError:
        return RETRY_BACKOFF_S


class AzureOpenAIClient:
    def __init__(self, client: Any | None = None, settings: EngineSettings | None = None,
                 backoff_s: float = RETRY_BACKOFF_S) -> None:
        self._settings = settings or get_settings()
        self._client = client
        self._backoff_s = backoff_s

    @property
    def client(self) -> Any:
        if self._client is None:
            s = self._settings
            if not s.aoai_configured:
                raise AoaiNotConfiguredError("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set")
            self._client = AsyncAzureOpenAI(
                azure_endpoint=s.azure_openai_endpoint,
                api_key=s.azure_openai_api_key.get_secret_value(),
                api_version=s.azure_openai_api_version,
                max_retries=0,
            )
        return self._client

    async def _call(self, fn: Callable[[], Awaitable[R]]) -> R:
        for attempt in (1, 2):
            try:
                return await fn()
            except openai.BadRequestError as exc:
                filters = _filters_from_error(exc)
                if filters is not None:
                    raise ContentFilteredError(filters, "prompt") from exc
                raise
            except RETRYABLE as exc:
                if attempt == 2:
                    raise
                delay = max(self._backoff_s, _retry_after(exc)) if self._backoff_s else 0.0
                log.warning("azure openai call failed (%s); retrying once in %.1fs", type(exc).__name__, delay)
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")

    async def chat_structured(self, messages: Sequence[dict[str, Any]], model: type[T], *,
                              temperature: float = 0.0, max_tokens: int | None = None) -> T:
        """Strict json_schema Structured Outputs call; returns the parsed model instance."""
        parsed, _ = await self.chat_structured_usage(messages, model, temperature=temperature, max_tokens=max_tokens)
        return parsed

    async def chat_structured_usage(self, messages: Sequence[dict[str, Any]], model: type[T], *,
                                    temperature: float = 0.0, max_tokens: int | None = None) -> tuple[T, int]:
        """chat_structured plus the call's total tokens (0 when the response has no usage)."""
        kwargs: dict[str, Any] = {"model": self._settings.azure_openai_chat_deployment,
                                  "messages": list(messages), "response_format": model,
                                  "temperature": temperature}
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        async def call() -> Any:
            try:
                return await self.client.chat.completions.parse(**kwargs)
            except openai.ContentFilterFinishReasonError as exc:
                raise ContentFilteredError(frozenset({"other"}), "completion") from exc
            except openai.LengthFinishReasonError as exc:
                raise StructuredOutputError("output truncated before it parsed") from exc

        completion = await self._call(call)
        choice = completion.choices[0]
        if choice.finish_reason == "content_filter":
            raise ContentFilteredError(_fired(getattr(choice, "content_filter_results", None)), "completion")
        message = choice.message
        if getattr(message, "refusal", None):
            raise StructuredOutputError(f"model refused: {message.refusal}")
        if message.parsed is None:
            raise StructuredOutputError("no parsed output")
        usage = getattr(completion, "usage", None)
        return message.parsed, int(getattr(usage, "total_tokens", 0) or 0)

    async def embed(self, texts: Sequence[str], *, batch_size: int = EMBED_BATCH) -> list[list[float]]:
        """Embed texts in batches; the result is in input order."""
        vectors: list[list[float]] = []
        for start in range(0, len(texts), batch_size):
            batch = list(texts[start:start + batch_size])

            async def call(batch: list[str] = batch) -> Any:
                return await self.client.embeddings.create(
                    model=self._settings.azure_openai_embed_deployment, input=batch)

            response = await self._call(call)
            vectors.extend(item.embedding for item in sorted(response.data, key=lambda d: d.index))
        return vectors

    async def aclose(self) -> None:
        if self._client is not None and hasattr(self._client, "close"):
            await self._client.close()
