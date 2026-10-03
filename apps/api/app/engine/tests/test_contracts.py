"""Every R contract parses into its engine model with no extra or missing fields.

Round trip: model_validate(payload).model_dump(exclude_unset) must equal the payload, so a
dropped, renamed or extra field in either the model or the example fails the test.
"""

import json
from typing import Any

import pytest
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.engine.fixtures import load_contract
from app.engine.schemas import (AnalyzeRequest, AssignRequest, AssignResponse, ClaimDismissed, ClaimPatchRequest,
                                GroveResponse, MemorySearchResponse, Mushroom, NextAction, NoteCreateRequest,
                                NoteCreateResponse, ProblemDetail, PruneRequest, PruneResponse, Stone, Tree,
                                WorkContextResponse, stream_line_adapter)

R_CONTRACTS = ["grove.example.json", "grove.degraded.example.json", "grove.stream.example.ndjson",
               "claims.example.json", "work-context.example.json", "memory-search.example.json",
               "prune.example.json"]


def roundtrip(model: type[BaseModel] | TypeAdapter, payload: Any) -> Any:
    if isinstance(model, TypeAdapter):
        obj = model.validate_python(payload)
        dumped = model.dump_python(obj, mode="json", exclude_unset=True)
    else:
        obj = model.model_validate(payload)
        dumped = obj.model_dump(mode="json", exclude_unset=True)
    assert dumped == payload
    return obj


@pytest.mark.parametrize("name", ["grove.example.json", "grove.degraded.example.json"])
def test_grove(name: str) -> None:
    grove = roundtrip(GroveResponse, load_contract(name))
    assert grove.degraded is (name == "grove.degraded.example.json")


def test_stream_lines() -> None:
    lines = load_contract("grove.stream.example.ndjson")
    parsed = [roundtrip(stream_line_adapter, line) for line in lines]
    assert [p.type for p in parsed] == ["clusters"] + ["tree"] * (len(lines) - 2) + ["done"]


CLAIM_RESPONSE = {"confirm": Stone, "edit": NextAction, "resolve": Mushroom, "dismiss": ClaimDismissed}


def test_claims_examples() -> None:
    examples = load_contract("claims.example.json")["examples"]
    for ex in examples:
        req, res = ex["request"], ex["response"]
        path, status, body = req["path"], res["status"], req["body"]
        if status == 422:
            with pytest.raises(ValidationError):
                ClaimPatchRequest.model_validate(body)
            roundtrip(ProblemDetail, res["body"])
        elif status >= 400:
            roundtrip(ClaimPatchRequest, body)
            roundtrip(ProblemDetail, res["body"])
        elif path.startswith("/api/claims/"):
            roundtrip(ClaimPatchRequest, body)
            roundtrip(CLAIM_RESPONSE[body["action"]], res["body"])
        elif path.endswith("/assign"):
            roundtrip(AssignRequest, body)
            roundtrip(AssignResponse, res["body"])
        elif path == "/api/notes":
            roundtrip(NoteCreateRequest, body)
            roundtrip(NoteCreateResponse, res["body"])
        elif path.endswith("/analyze"):
            assert body is None
            roundtrip(Tree, res["body"])
        else:
            pytest.fail(f"unmapped claims example: {ex['name']}")
    assert len(examples) == 10


def test_work_context() -> None:
    contract = load_contract("work-context.example.json")
    analyze, too_large = contract["examples"]
    roundtrip(AnalyzeRequest, analyze["request"]["body"])
    response = roundtrip(WorkContextResponse, analyze["response"]["body"])
    assert {i.provenance for i in [response.goal, *response.decisions, *response.open_questions]} >= {"sourced", "inferred"}
    assert too_large["response"]["status"] == 413
    roundtrip(ProblemDetail, too_large["response"]["body"])
    items_json = next(f for f in contract["upload"]["fields"] if f["name"] == "items_json")["example"]
    roundtrip(AnalyzeRequest, {"items": json.loads(items_json)})


def test_work_item_limits() -> None:
    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate({"items": [{"kind": "paste", "title": "t", "text": "x" * 12_001}]})
    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate({"items": [{"kind": "paste", "title": "t", "domain": "a.b", "text": "x"}]})


def test_memory_search() -> None:
    found, not_found = (ex["response"]["body"] for ex in load_contract("memory-search.example.json")["examples"])
    assert roundtrip(MemorySearchResponse, found).found is True
    assert roundtrip(MemorySearchResponse, not_found).matches == []


def test_prune() -> None:
    ex = load_contract("prune.example.json")["examples"][0]
    roundtrip(PruneRequest, ex["request"]["body"])
    roundtrip(PruneResponse, ex["response"]["body"])


@pytest.mark.parametrize("name", R_CONTRACTS)
def test_every_r_contract_exists(name: str) -> None:
    assert load_contract(name)


def test_request_models_reject_user_id() -> None:
    for model, body in [(ClaimPatchRequest, {"action": "dismiss"}), (PruneRequest, {"tab_refs": ["00000000-0000-4000-8000-000000000001"]}),
                        (AssignRequest, {"new_project_name": "x"}), (AnalyzeRequest, {"items": [{"kind": "paste", "title": "t", "text": "x"}]})]:
        model.model_validate(body)
        with pytest.raises(ValidationError):
            model.model_validate({**body, "user_id": "00000000-0000-4000-8000-000000000001"})
