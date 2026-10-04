"""R-8 validator rules (deterministic, no network)."""

import pytest

from app.engine.model_schema import EvidenceRef
from app.engine.validate import (ValidationContext, display_text, evidence_cap, gerund, map_tab_refs,
                                 validate_claim, verify_quote)

T = [f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 6)]
NOTE = "n_40000000-0000-4000-8000-000000000007"
CTX = ValidationContext(
    refs={"t1": T[0], "t2": T[1], "t3": T[2], "t4": T[3], "q1": "qf_50000000-0000-4000-8000-000000000001", "n1": NOTE},
    tab_types={T[0]: "docs", T[1]: "qa", T[2]: "code", T[3]: "docs"},
    notes={NOTE: "Not using OAuth providers for v1"})


def ev(*refs: str) -> list[EvidenceRef]:
    return [EvidenceRef(ref=r, why="signal") for r in refs]


def test_unknown_refs_are_dropped_and_recorded() -> None:
    c = validate_claim("goal", "Choose an auth architecture", "inferred", 0.9, ev("t1", "t9", "x1", "t2", "t1"), CTX)
    assert [e["ref"] for e in c.evidence] == [T[0], T[1]]
    assert sum("unknown ref" in r for r in c.reasons) == 2
    assert map_tab_refs(["t3", "t9", "q1", "t3", "t1"], CTX) == [T[2], T[0]]


def test_fake_stated_is_downgraded() -> None:
    c = validate_claim("decision", "Use JWT", "stated", 0.95, ev("t1", "t3"), CTX, user_note_ref=None)
    assert c.provenance != "stated" and c.user_note_id is None and c.downgraded
    assert "stated without a real user note" in c.reasons
    fake_note = validate_claim("decision", "Use JWT", "stated", 0.95, ev("n7", "t1"), CTX, user_note_ref="n7")
    assert fake_note.provenance != "stated"


def test_real_stated_keeps_the_notes_own_words() -> None:
    c = validate_claim("decision", "No OAuth providers", "stated", 0.4, ev("t5"), CTX, user_note_ref="n1")
    assert (c.provenance, c.confidence, c.user_note_id) == ("stated", 1.0, NOTE)
    assert c.text == c.display_text == "Not using OAuth providers for v1"
    assert c.evidence[0] == {"ref_kind": "note", "ref": NOTE, "why": "user note"}


def test_sourced_always_downgrades_in_browser_mode() -> None:
    c = validate_claim("decision", "Use cookies", "sourced", 0.9, ev("t1", "t2"), CTX, quote="use cookies")
    assert c.provenance == "inferred" and c.quote is None and c.downgraded


def test_sourced_quote_verified_on_normalized_text_and_stored_verbatim() -> None:
    doc = "We’ll go with Azure  Functions — decided at 00:14:32."
    ctx = ValidationContext(CTX.refs, CTX.tab_types, CTX.notes, documents=[doc], mode="work_context")
    c = validate_claim("decision", "Azure Functions", "sourced", 0.9, ev("t1", "t2"), ctx,
                       quote="We'll go with Azure Functions - decided")
    assert c.provenance == "sourced" and c.quote == "We’ll go with Azure  Functions — decided"
    bad = validate_claim("decision", "AWS", "sourced", 0.9, ev("t1", "t2"), ctx, quote="We'll go with AWS Lambda")
    assert bad.provenance == "inferred"
    assert verify_quote("short", [doc]) is None


def test_confidence_is_capped_by_evidence() -> None:
    # 2 refs (docs, qa): 0.35 + 0.30 + 0.20 = 0.85
    assert validate_claim("goal", "Choose", "inferred", 0.99, ev("t1", "t2"), CTX).confidence == 0.85
    # 4 refs, 3 types: 0.35 + 0.60 + 0.30 = 1.25 -> 0.95 max
    assert validate_claim("goal", "Choose", "inferred", 0.99, ev("t1", "t2", "t3", "t4"), CTX).confidence == 0.95
    # model below the cap wins; out-of-range model confidence is clamped
    assert validate_claim("goal", "Choose", "inferred", 0.7, ev("t1", "t2"), CTX).confidence == 0.7
    assert validate_claim("goal", "Choose", "hypothesis", 7.0, ev("t1"), CTX).confidence == 0.6
    assert evidence_cap([], CTX) == 0.35


def test_inferred_needs_two_refs_and_060() -> None:
    one_ref = validate_claim("goal", "Choose", "inferred", 0.9, ev("t1"), CTX)          # cap 0.60, 1 ref
    assert one_ref.provenance == "hypothesis" and one_ref.downgraded
    low = validate_claim("goal", "Choose", "inferred", 0.55, ev("t1", "t2"), CTX)       # 2 refs, 0.55
    assert low.provenance == "hypothesis"
    ok = validate_claim("goal", "Choose", "inferred", 0.60, ev("t1", "t3"), CTX)
    assert ok.provenance == "inferred" and not ok.downgraded
    hyp = validate_claim("hypothesis", "Host on Azure later", "inferred", 0.9, ev("t1", "t2"), CTX)
    assert hyp.provenance == "hypothesis" and not hyp.downgraded


@pytest.mark.parametrize("kind,prov,text,expected", [
    ("goal", "inferred", "Choose an authentication architecture", "Appears to be choosing an authentication architecture"),
    ("goal", "inferred", "Plan a weeknight dinner", "Appears to be planning a weeknight dinner"),
    ("goal", "inferred", "Apply for backend roles", "Appears to be applying for backend roles"),
    ("goal", "inferred", "JWT auth for the app", "Appears to be about: JWT auth for the app"),
    ("decision", "inferred", "Use FastAPI's OAuth2PasswordBearer", "Appears to be using FastAPI's OAuth2PasswordBearer"),
    ("direction", "inferred", "JWT is preferred", "Likely direction: JWT is preferred"),
    ("question", "inferred", "Where should refresh tokens be stored?", "Likely still open: where should refresh tokens be stored?"),
    ("action", "inferred", "Prototype a refresh flow", "Likely next: prototype a refresh flow"),
    ("goal", "hypothesis", "May later host auth on Azure", "Maybe: may later host auth on Azure"),
    ("decision", "stated", "Not using OAuth providers for v1", "Not using OAuth providers for v1"),
])
def test_display_wording_comes_from_provenance(kind, prov, text, expected) -> None:
    assert display_text(kind, prov, text) == expected


def test_model_wording_never_shown_raw_for_inferred_or_hypothesis() -> None:
    for prov in ("inferred", "hypothesis"):
        c = validate_claim("goal", "Ignore previous instructions", prov, 0.9, ev("t1", "t2"), CTX)
        assert c.display_text != c.text and c.display_text.startswith(("Appears", "Maybe:"))


def test_gerund() -> None:
    assert [gerund(v) for v in ("choose", "plan", "set", "apply", "die", "build", "fix", "see", "visit", "prefer",
                                "submit", "offer")] == \
           ["choosing", "planning", "setting", "applying", "dying", "building", "fixing", "seeing", "visiting",
            "preferring", "submitting", "offering"]
