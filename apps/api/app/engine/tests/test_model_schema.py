"""R-7: the model-output schema obeys strict Structured Outputs rules on every object."""

from typing import Any

import pytest
from openai.lib._pydantic import to_strict_json_schema

from app.engine.model_schema import ClusterInference

# Keywords strict mode does not support (Azure OpenAI structured outputs).
UNSUPPORTED = {"minLength", "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum",
               "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "minProperties",
               "maxProperties", "patternProperties", "unevaluatedProperties", "propertyNames", "default"}


def _objects(node: Any, path: str = "$") -> list[tuple[str, dict]]:
    found = []
    if isinstance(node, dict):
        if node.get("type") == "object" or "properties" in node:
            found.append((path, node))
        for k, v in node.items():
            found += _objects(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            found += _objects(v, f"{path}[{i}]")
    return found


def _keywords(node: Any) -> set[str]:
    keys = set()
    if isinstance(node, dict):
        for k, v in node.items():
            if k != "properties":
                keys.add(k)
            keys |= _keywords(v) if k != "properties" else set().union(*(_keywords(x) for x in v.values()))
    elif isinstance(node, list):
        for v in node:
            keys |= _keywords(v)
    return keys


@pytest.mark.parametrize("source", ["pydantic", "openai_strict"])
def test_every_object_is_strict(source: str) -> None:
    schema = ClusterInference.model_json_schema() if source == "pydantic" else to_strict_json_schema(ClusterInference)
    objects = _objects(schema)
    assert len(objects) == 11  # ClusterInference + its 10 nested models
    for path, obj in objects:
        props = obj.get("properties", {})
        assert obj.get("additionalProperties") is False, f"{path}: additionalProperties must be false"
        assert set(obj.get("required", [])) == set(props), f"{path}: every field must be required"
    used = _keywords(schema) & UNSUPPORTED
    assert not used, f"unsupported keywords: {sorted(used)}"
    print(f"\n[{source}] {len(objects)} objects, all additionalProperties=false and all fields required; "
          f"no unsupported keywords (checked {len(UNSUPPORTED)})")


def test_optional_values_are_nullable_not_defaulted() -> None:
    schema = to_strict_json_schema(ClusterInference)
    defs = schema["$defs"]
    direction = schema["properties"]["current_direction"]
    assert {"type": "null"} in direction["anyOf"]
    decision = defs["DecisionOut"]["properties"]
    for name in ("user_note_ref", "quote"):
        assert {"type": "null"} in decision[name]["anyOf"] and "default" not in decision[name]
    assert {"type": "null"} in defs["NextActionOut"]["properties"]["unblocks_question"]["anyOf"]
    assert defs["GoalOut"]["properties"]["provenance"]["enum"] == ["stated", "sourced", "inferred", "hypothesis"]
