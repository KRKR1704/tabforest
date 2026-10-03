"""AzureOpenAIClient behaviour with a fake SDK client: content filters, retries, batching."""

import asyncio
from types import SimpleNamespace

import httpx
import openai
import pytest
from pydantic import BaseModel

from app.engine.aoai import AzureOpenAIClient, ContentFilteredError
from app.engine.settings import EngineSettings

REQUEST = httpx.Request("POST", "https://example.invalid/openai")
SETTINGS = EngineSettings(_env_file=None, azure_openai_endpoint="https://example.invalid", azure_openai_api_key="k")


class Answer(BaseModel):
    text: str


def content_filter_error(results: dict, wrapped: bool = False) -> openai.BadRequestError:
    error = {"code": "content_filter", "message": "filtered",
             "innererror": {"code": "ResponsibleAIPolicyViolation", "content_filter_result": results}}
    return openai.BadRequestError("filtered", response=httpx.Response(400, request=REQUEST),
                                  body={"error": error} if wrapped else error)


def completion(parsed=None, finish_reason="stop", filter_results=None):
    message = SimpleNamespace(parsed=parsed, refusal=None)
    choice = SimpleNamespace(message=message, finish_reason=finish_reason, content_filter_results=filter_results)
    return SimpleNamespace(choices=[choice])


def fake_client(parse=None, create=None):
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse)),
                           embeddings=SimpleNamespace(create=create))


def scripted(*outcomes):
    calls = []

    async def fn(**kwargs):
        calls.append(kwargs)
        outcome = outcomes[len(calls) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return fn, calls


@pytest.mark.parametrize("results,expected,wrapped", [
    ({"jailbreak": {"filtered": True, "detected": True}, "hate": {"filtered": False, "severity": "safe"}},
     {"jailbreak"}, False),
    ({"indirect_attack": {"filtered": True, "detected": True}}, {"indirect_attack"}, True),
    ({"violence": {"filtered": True, "severity": "high"}}, {"other"}, False),
])
def test_prompt_content_filter_raises_without_retry(results, expected, wrapped) -> None:
    parse, calls = scripted(content_filter_error(results, wrapped), completion(Answer(text="x")))
    client = AzureOpenAIClient(fake_client(parse=parse), SETTINGS, backoff_s=0)
    with pytest.raises(ContentFilteredError) as info:
        asyncio.run(client.chat_structured([{"role": "user", "content": "hi"}], Answer))
    assert info.value.filters == frozenset(expected)
    assert info.value.where == "prompt"
    assert len(calls) == 1


def test_completion_content_filter() -> None:
    filtered = completion(finish_reason="content_filter",
                          filter_results={"jailbreak": {"filtered": True, "detected": True}})
    parse, _ = scripted(filtered)
    with pytest.raises(ContentFilteredError) as info:
        asyncio.run(AzureOpenAIClient(fake_client(parse=parse), SETTINGS).chat_structured([], Answer))
    assert info.value.where == "completion" and info.value.filters == frozenset({"jailbreak"})


def test_retries_once_on_429_then_succeeds() -> None:
    rate_limited = openai.RateLimitError("slow down", response=httpx.Response(429, request=REQUEST), body=None)
    parse, calls = scripted(rate_limited, completion(Answer(text="ok")))
    result = asyncio.run(AzureOpenAIClient(fake_client(parse=parse), SETTINGS, backoff_s=0).chat_structured([], Answer))
    assert result == Answer(text="ok")
    assert len(calls) == 2


def test_gives_up_after_one_retry() -> None:
    timeout = openai.APITimeoutError(request=REQUEST)
    server = openai.InternalServerError("boom", response=httpx.Response(503, request=REQUEST), body=None)
    parse, calls = scripted(timeout, server, completion(Answer(text="never")))
    with pytest.raises(openai.InternalServerError):
        asyncio.run(AzureOpenAIClient(fake_client(parse=parse), SETTINGS, backoff_s=0).chat_structured([], Answer))
    assert len(calls) == 2


def test_embed_batches_and_keeps_order() -> None:
    calls = []

    async def create(model, input):
        calls.append(len(input))
        data = [SimpleNamespace(index=i, embedding=[float(len(t))]) for i, t in enumerate(input)]
        return SimpleNamespace(data=list(reversed(data)))

    texts = ["x" * n for n in range(1, 131)]
    vectors = asyncio.run(AzureOpenAIClient(fake_client(create=create), SETTINGS).embed(texts, batch_size=64))
    assert calls == [64, 64, 2]
    assert vectors == [[float(n)] for n in range(1, 131)]


def test_settings_repr_hides_secrets() -> None:
    s = EngineSettings(_env_file=None, azure_openai_api_key="super-secret-key", database_url="postgres://u:pw@h/db")
    assert "super-secret-key" not in repr(s) and "pw@h" not in repr(s)
