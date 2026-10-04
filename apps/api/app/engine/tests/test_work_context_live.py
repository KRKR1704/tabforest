"""R-11 live: the SAMPLE documents through the real Azure OpenAI model (no database needed).

Checks the acceptance line of R-11: the "Azure Functions" decision comes back sourced with the 00:14:32 cue, the
"credentials" blocker is found, every quote is verbatim, and the noise listed in EXPECTED.json is not extracted.
Run with -s to see the claims. Skipped without AZURE_OPENAI_API_KEY.
"""

import asyncio
import json

import pytest

from app.engine import work_context as wc
from app.engine.aoai import AzureOpenAIClient
from app.engine.schemas import WorkContextResponse
from app.engine.settings import get_settings
from app.engine.tests.test_work_context import ITEMS, KEY

pytestmark = pytest.mark.skipif(not get_settings().aoai_configured, reason="AZURE_OPENAI_API_KEY not set")


def test_sample_documents_with_the_real_model() -> None:
    async def go():
        client = AzureOpenAIClient()
        try:
            return await wc.analyze_documents(wc.make_docs(ITEMS), client)
        finally:
            await client.aclose()

    response, numbers = asyncio.run(go())
    print(json.dumps(response, indent=2, ensure_ascii=False))
    print(numbers)
    WorkContextResponse.model_validate(response)
    texts = {i.title: i.text for i in ITEMS}
    claims = [response["goal"], *response["decisions"], *response["blockers"], *response["owners"],
              *response["open_questions"], *response["next_actions"]]
    for c in claims:
        if c["quote"]:
            assert c["quote"] in texts[c["source"]], c["quote"]
    decision = next(d for d in response["decisions"] if "functions" in d["text"].lower())
    assert decision["provenance"] == "sourced" and decision["timestamp"] == "00:14:32"
    assert any("credential" in b["text"].lower() for b in response["blockers"])
    everything = " ".join(c["text"].lower() for c in claims)
    for noise in ("fire drill", "renewal", "premium support"):
        assert noise not in everything, noise
    assert all(c["provenance"] != "stated" for c in claims) and KEY["project"]
