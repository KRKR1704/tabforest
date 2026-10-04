"""Evidence validator (R-8, proposal §2 "Four levels of certainty", §14 step 9, §15).

Deterministic; the model never gets the final word:
- short refs map back to real ids; a ref that is not in this cluster's DATA is dropped;
- stated only when the claim cites an n* ref that maps to a real note of this user; the stored text
  is then the note's own wording;
- sourced only with a quote found in supplied text (normalize_for_match on both sides; the source's
  original wording is stored). Browser mode has no documents, so sourced always downgrades;
- confidence = min(model_conf, 0.35 + 0.15·valid_refs + 0.10·distinct_source_types, 0.95);
  a stated claim is the user's own words and keeps confidence 1.0;
- inferred needs ≥ 2 valid refs and final confidence ≥ 0.60, else it becomes a hypothesis (fog);
- display_text is set from the provenance, never the model's wording alone.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from .normalize import _MATCH_TRANSLATE

Kind = Literal["goal", "direction", "decision", "question", "blocker", "action", "hypothesis"]
RANK = {"hypothesis": 0, "inferred": 1, "sourced": 2, "stated": 3}
REF_KIND = {"t": "tab", "q": "query", "n": "note", "d": "doc"}
CAP_BASE, CAP_PER_REF, CAP_PER_TYPE, CAP_MAX = 0.35, 0.15, 0.10, 0.95
INFERRED_MIN_REFS, INFERRED_MIN_CONFIDENCE = 2, 0.60
_SHORT_REF = re.compile(r"^[tqnd]\d+$")


@dataclass
class ValidationContext:
    refs: Mapping[str, str]                 # short ref -> real id (features.DataBlock.refs)
    tab_types: Mapping[str, str]            # real tab_ref -> leaf source type
    notes: Mapping[str, str]                # real note id ("n_<uuid>") -> text, this user's notes only
    documents: Sequence[str] = ()           # supplied text (Work Context); empty in browser mode
    mode: Literal["browser", "work_context"] = "browser"


@dataclass
class ValidatedClaim:
    kind: Kind
    text: str
    provenance: str
    confidence: float
    display_text: str
    evidence: list[dict[str, str]]
    user_note_id: str | None = None
    quote: str | None = None
    model_provenance: str = ""
    model_confidence: float = 0.0
    reasons: list[str] = field(default_factory=list)  # why it was downgraded or refs dropped

    @property
    def downgraded(self) -> bool:
        return RANK[self.provenance] < RANK.get(self.model_provenance, 0)


# ---------------------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------------------

def _normalized_with_map(text: str) -> tuple[str, list[int]]:
    """normalize_for_match(text) plus, for every output char, its index in `text`."""
    out: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(text):
        t = ch.translate(_MATCH_TRANSLATE)
        for c in t:
            if c.isspace():
                if not out or out[-1] == " ":
                    continue
                c = " "
            out.append(c)
            index.append(i)
    while out and out[-1] == " ":
        out.pop()
        index.pop()
    return "".join(out), index


def verify_quote(quote: str | None, documents: Sequence[str]) -> str | None:
    """The source's original wording of `quote` if its normalized form is in a document, else None."""
    q, _ = _normalized_with_map(quote or "")
    if len(q) < 8:
        return None
    for doc in documents:
        norm, index = _normalized_with_map(doc)
        at = norm.find(q)
        if at >= 0:
            return doc[index[at]:index[at + len(q) - 1] + 1]
    return None


# ---------------------------------------------------------------------------------------
# Wording
# ---------------------------------------------------------------------------------------

def _lower_first(text: str) -> str:
    text = text.strip()
    if len(text) > 1 and text[1].isupper():  # acronym: JWT, OAuth
        return text
    return text[:1].lower() + text[1:]


_NO_DOUBLE = set("wxy")
# Stressed final syllable: the consonant doubles (prefer -> preferring).
_DOUBLES = {"prefer", "refer", "defer", "occur", "admit", "commit", "submit", "permit", "omit", "regret",
            "control", "begin", "forget", "upset", "equip", "transfer", "compel", "propel", "rebut"}


def gerund(verb: str) -> str:
    v = verb.lower()
    if v.endswith("ing") and len(v) > 4:
        return v
    if v in _DOUBLES:
        return v + v[-1] + "ing"
    if v.endswith("ie"):
        return v[:-2] + "ying"
    if v.endswith("e") and not v.endswith(("ee", "ye", "oe")) and len(v) > 2:
        return v[:-1] + "ing"
    if (len(v) <= 4 and len(v) >= 3 and v[-1] not in "aeiou" and v[-1] not in _NO_DOUBLE
            and v[-2] in "aeiou" and v[-3] not in "aeiou"):
        return v + v[-1] + "ing"
    return v + "ing"


def _appears_to_be(text: str) -> str:
    words = text.strip().rstrip(".").split(" ", 1)
    if not words[0].isalpha() or (len(words[0]) > 1 and words[0][1].isupper()):
        return "Appears to be about: " + _lower_first(text.rstrip("."))
    return "Appears to be " + " ".join([gerund(words[0]), *words[1:]])


def display_text(kind: Kind, provenance: str, text: str) -> str:
    text = text.strip()
    if provenance in ("stated", "sourced"):
        return text
    if provenance == "hypothesis":
        return "Maybe: " + _lower_first(text)
    if kind in ("goal", "decision"):
        return _appears_to_be(text)
    prefix = {"direction": "Likely direction: ", "question": "Likely still open: ", "action": "Likely next: ",
              "blocker": "Likely blocker: "}.get(kind, "Likely: ")
    return prefix + _lower_first(text)


# ---------------------------------------------------------------------------------------
# Claims
# ---------------------------------------------------------------------------------------

def _map_evidence(evidence: Sequence[Any], ctx: ValidationContext, reasons: list[str]) -> list[dict[str, str]]:
    out, seen = [], set()
    for ev in evidence:
        ref = (getattr(ev, "ref", None) or "").strip()
        why = (getattr(ev, "why", None) or "").strip()[:200]
        real = ctx.refs.get(ref) if _SHORT_REF.match(ref) else None
        if real is None:
            reasons.append(f"dropped unknown ref {ref[:20]!r}")
            continue
        if real in seen:
            continue
        seen.add(real)
        out.append({"ref_kind": REF_KIND[ref[0]], "ref": real, "why": why})
    return out


def evidence_cap(evidence: Sequence[Mapping[str, str]], ctx: ValidationContext) -> float:
    types = set()
    for ev in evidence:
        if ev["ref_kind"] == "tab":
            types.add(ctx.tab_types.get(ev["ref"], "other"))
        else:
            types.add(ev["ref_kind"])
    return min(CAP_BASE + CAP_PER_REF * len(evidence) + CAP_PER_TYPE * len(types), CAP_MAX)


def validate_claim(kind: Kind, text: str, provenance: str, confidence: float, evidence: Sequence[Any],
                   ctx: ValidationContext, *, user_note_ref: str | None = None,
                   quote: str | None = None) -> ValidatedClaim:
    reasons: list[str] = []
    ev = _map_evidence(evidence, ctx, reasons)
    model_conf = min(max(float(confidence or 0.0), 0.0), 1.0)
    final = provenance if kind != "hypothesis" and provenance in RANK else "hypothesis"
    claim = ValidatedClaim(kind, text.strip(), final, model_conf, "", ev, model_provenance=final,
                           model_confidence=model_conf, reasons=reasons)

    if final == "stated":
        candidates = [user_note_ref] if user_note_ref else []
        candidates += [r for r in (getattr(e, "ref", "") for e in evidence) if r and r.startswith("n")]
        note_id = next((ctx.refs[r] for r in candidates if r in ctx.refs and ctx.refs[r] in ctx.notes), None)
        if note_id is None:
            reasons.append("stated without a real user note")
            final = "inferred"
        else:
            claim.user_note_id = note_id
            claim.text = ctx.notes[note_id]
            if not any(e["ref"] == note_id for e in ev):
                ev.insert(0, {"ref_kind": "note", "ref": note_id, "why": "user note"})
            claim.provenance, claim.confidence = "stated", 1.0
            claim.display_text = display_text(kind, "stated", claim.text)
            return claim

    if final == "sourced":
        original = verify_quote(quote, ctx.documents) if ctx.mode == "work_context" else None
        if original is None:
            reasons.append("sourced without documents (browser mode)" if ctx.mode == "browser"
                           else "quote not found in supplied text")
            final = "inferred"
        else:
            claim.quote = original

    cap = evidence_cap(ev, ctx)
    claim.confidence = round(min(model_conf, cap), 2)
    if final == "sourced":
        claim.provenance = "sourced"
    elif final == "inferred":
        if len(ev) >= INFERRED_MIN_REFS and claim.confidence >= INFERRED_MIN_CONFIDENCE:
            claim.provenance = "inferred"
        else:
            reasons.append(f"inferred needs >= {INFERRED_MIN_REFS} valid refs and confidence >= "
                           f"{INFERRED_MIN_CONFIDENCE} (had {len(ev)} refs, {claim.confidence})")
            claim.provenance = "hypothesis"
    else:
        claim.provenance = "hypothesis"
    claim.display_text = display_text(kind, claim.provenance, claim.text)
    return claim


def map_tab_refs(refs: Sequence[str], ctx: ValidationContext) -> list[str]:
    """Short tab refs -> real tab_refs; unknown or non-tab refs dropped, order kept, no repeats."""
    out = []
    for r in refs:
        real = ctx.refs.get(r) if isinstance(r, str) and r.startswith("t") else None
        if real and real not in out:
            out.append(real)
    return out
