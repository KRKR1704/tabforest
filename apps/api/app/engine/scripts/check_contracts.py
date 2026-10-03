"""Check every R-drafted contract in contracts/ against the grove, the demo tabs and the SAMPLE docs.

Run from the repo root:
    apps\\api\\.venv\\Scripts\\python apps\\api\\app\\engine\\scripts\\check_contracts.py [contracts_dir]

contracts_dir defaults to contracts/ (pass a copy to test broken files). Runs the grove checks
from check_grove_contract.py plus cross-contract checks. Exits non-zero if any check fails.
"""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import check_grove_contract as grove_checks
from check_grove_contract import SNAKE, record, results, tree_leaves, walk_keys

REPO = Path(__file__).resolve().parents[5]
CONTRACTS = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / "contracts"
FIXTURES = REPO / "apps" / "api" / "app" / "engine" / "fixtures"
SAMPLE_DOCS = FIXTURES / "sample_docs"
GENERATOR = Path(__file__).resolve().parent / "gen_contracts.py"
GENERATED = [FIXTURES / "demo_tabs.json"] + [REPO / "contracts" / n for n in (
    "grove.example.json", "grove.degraded.example.json", "grove.stream.example.ndjson", "claims.example.json",
    "work-context.example.json", "memory-search.example.json", "prune.example.json")]
ID = re.compile(r"\b(?:[a-z]+_)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b")
CLAIM_KEYS = {"id", "text", "provenance", "confidence", "display_text", "evidence"}
WC_FILES = {
    "CAM-142 · Customer Authentication Migration": "jira-CAM-142.md",
    "Token service on Azure Functions (WIP) #418": "pr-418.md",
    "Account note: Fabrikam": "customer-note.md",
    "Teams transcript excerpt: CAM arch sync 2026-09-22": "teams-transcript.vtt",
}


def ids_in(node) -> set[str]:
    return set(ID.findall(json.dumps(node, ensure_ascii=False)))


def dicts(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from dicts(v)
    elif isinstance(node, list):
        for v in node:
            yield from dicts(v)


def claims_in(node) -> list[dict]:
    return [d for d in dicts(node) if CLAIM_KEYS <= d.keys()]


def vtt_cues(text: str) -> list[tuple[str, str]]:
    return [(b.strip("\n").split("\n")[0], "\n".join(b.strip("\n").split("\n")[1:]))
            for b in text.split("\n\n") if "-->" in b]


def load(name: str):
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def main() -> int:
    tabs = json.loads((FIXTURES / "demo_tabs.json").read_text(encoding="utf-8"))["open_tabs"]
    snap = {t["tab_ref"]: t for t in tabs}
    expected = json.loads((SAMPLE_DOCS / "EXPECTED.json").read_text(encoding="utf-8"))
    docs = {name: (SAMPLE_DOCS / name).read_text(encoding="utf-8") for name in set(WC_FILES.values()) | {"migration-doc.md"}}
    try:
        grove, degraded = load("grove.example.json"), load("grove.degraded.example.json")
        stream_text = (CONTRACTS / "grove.stream.example.ndjson").read_text(encoding="utf-8")
        files = {n: load(n) for n in ("claims.example.json", "work-context.example.json",
                                      "memory-search.example.json", "prune.example.json")}
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[FAIL] could not load contracts from {CONTRACTS}: {exc}")
        return 1
    claims_c, wc_c, mem_c, prune_c = files.values()

    # Grove checks (25) from check_grove_contract.py.
    grove_checks.JOB_PROJECT_ID = next(t["project_id"] for t in grove["trees"] if t["name"] == "Job Search")
    grove_checks.check_grove(grove, snap, "grove", degraded=False)
    grove_checks.check_grove(degraded, snap, "grove.degraded", degraded=True)
    grove_checks.check_stream(stream_text, grove, degraded, snap)

    known = set(snap) | ids_in(grove) | ids_in(degraded) | ids_in([json.loads(l) for l in stream_text.splitlines()])
    trees = {t["project_id"]: t for t in grove["trees"]}
    grove_claims = {c["id"]: c for c in claims_in(grove)}
    leaf_types = {l["tab_ref"]: l["source_type"] for t in grove["trees"] for l in tree_leaves(t)}
    wc_resp = wc_c["examples"][0]["response"]["body"]
    doc_types = {d["id"]: d["source_type"] for d in wc_resp["documents"]}

    # A. Ids: requests reference only known ids; responses add only ids they declare in `introduces`.
    problems, all_intro = [], {}
    for fname, contract in files.items():
        for ex in contract["examples"]:
            tag = f"{fname} · {ex['name']}"
            intro, unknown = set(ex["introduces"]), set(ex.get("unknown_ids", []))
            req, resp = ids_in(ex["request"]), ids_in(ex["response"])
            problems += [f"{tag}: introduces existing id {i}" for i in intro & known]
            problems += [f"{tag}: introduced id {i} not in response" for i in intro - resp]
            problems += [f"{tag}: request uses unknown id {i}" for i in req - known - unknown]
            problems += [f"{tag}: response uses undeclared id {i}" for i in resp - known - intro - unknown]
            for i in intro:
                if i in all_intro:
                    problems.append(f"{tag}: id {i} also introduced by {all_intro[i]}")
                all_intro[i] = tag
    record("A. every tab/claim/project/note id exists in grove or demo_tabs, or is introduced by its own response", problems)

    # B. Provenance rules on every claim in every contract file.
    problems = []
    defined_notes = {i for i in known | set(all_intro) if i.startswith("n_")}
    for fname, contract in {"grove.example.json": grove, "grove.degraded.example.json": degraded, **files}.items():
        for c in claims_in(contract):
            p, conf, tag = c["provenance"], c["confidence"], f"{fname} {c['id']}"
            if p == "stated" and not (c.get("user_note_id") in defined_notes and
                                      any(e["ref_kind"] == "note" and e["ref"] == c["user_note_id"] for e in c["evidence"])):
                problems.append(f"{tag}: stated needs a defined user_note_id cited as note evidence")
            if p == "sourced" and not c.get("quote"):
                problems.append(f"{tag}: sourced without quote")
            if p == "inferred" and (len(c["evidence"]) < 2 or conf < 0.60):
                problems.append(f"{tag}: inferred needs >= 2 evidence and confidence >= 0.60")
            if p not in {"stated", "sourced", "inferred", "hypothesis"}:
                problems.append(f"{tag}: unknown provenance {p}")
            if p != "stated" and conf < 0.60 and p != "hypothesis":
                problems.append(f"{tag}: confidence {conf} < 0.60 must be hypothesis")
            d = c["display_text"]
            if (p == "inferred" and not re.search(r"\b(appears|likely)\b", d, re.I)) or \
               (p == "hypothesis" and not d.startswith("Maybe:")) or (p in {"stated", "sourced"} and d != c["text"]):
                problems.append(f"{tag}: display_text {d!r} does not match provenance {p}")
            for e in c["evidence"]:
                ok = {"tab": e["ref"] in snap, "doc": e["ref"] in doc_types, "note": e["ref"] in defined_notes,
                      "query": e["ref"] in known}.get(e["ref_kind"], False)
                if not ok:
                    problems.append(f"{tag}: evidence {e['ref_kind']} {e['ref']} does not resolve")
            if p != "stated":
                types = {leaf_types.get(e["ref"]) if e["ref_kind"] == "tab" else doc_types.get(e["ref"])
                         if e["ref_kind"] == "doc" else {"note": "note", "query": "search"}[e["ref_kind"]]
                         for e in c["evidence"]}
                cap = min(0.95, 0.35 + 0.15 * len(c["evidence"]) + 0.10 * len(types))
                if conf > cap + 1e-9:
                    problems.append(f"{tag}: confidence {conf} > cap {cap:.2f}")
    record("B. provenance, display wording, evidence resolution and confidence cap hold on every claim in every file", problems)

    # C. No user_id in request bodies (except the 422 example, which must have it); snake_case keys everywhere.
    problems = []
    for fname, contract in files.items():
        for ex in contract["examples"]:
            body = ex["request"]["body"]
            has = any("user_id" in d for d in dicts(body))
            if ex["response"]["status"] == 422:
                if not has or not any(e["loc"] == ["body", "user_id"] for e in ex["response"]["body"].get("errors", [])):
                    problems.append(f"{fname} · {ex['name']}: 422 example must send user_id and reject it")
            elif has:
                problems.append(f"{fname} · {ex['name']}: request body contains user_id")
        problems += [f"{fname} {path}: {k}" for k, path in walk_keys(contract) if not SNAKE.match(k)]
    for i, line in enumerate(stream_text.splitlines(), 1):
        problems += [f"stream line {i} {path}: {k}" for k, path in walk_keys(json.loads(line)) if not SNAKE.match(k)]
    items_json = json.loads(next(f for f in wc_c["upload"]["fields"] if f["name"] == "items_json")["example"])
    problems += [f"items_json key {k}" for k, _ in walk_keys(items_json) if not SNAKE.match(k)]
    problems += ["items_json user_id" for d in dicts(items_json) if "user_id" in d]
    record("C. no request body has user_id (422 example excepted); all keys snake_case", problems)

    # D. Claims endpoint semantics.
    problems = []
    by_action = {e["request"]["body"].get("action"): e for e in claims_c["examples"]
                 if e["request"]["body"] and e["response"]["status"] == 200 and "/api/claims/" in e["request"]["path"]}
    target = lambda e: grove_claims.get(e["request"]["path"].rsplit("/", 1)[1])
    c, r = target(by_action["confirm"]), by_action["confirm"]["response"]["body"]
    if not (c and c["provenance"] == "inferred" and c.get("kind") == "mossy" and r["provenance"] == "stated"
            and r["kind"] == "carved" and r["user_note_id"] in by_action["confirm"]["introduces"]):
        problems.append("confirm: must turn a mossy inferred stone into a carved stated one with a new note")
    c, e = target(by_action["edit"]), by_action["edit"]
    if not (c and c.get("unblocks") is not None and e["response"]["body"]["text"] == e["request"]["body"]["text"]):
        problems.append("edit: must target a next action and return the new text")
    c, e = target(by_action["dismiss"]), by_action["dismiss"]
    if not (c and c["provenance"] == "hypothesis" and e["response"]["body"]["status"] == "dismissed"):
        problems.append("dismiss: must target the hypothesis and return status dismissed")
    c, e = target(by_action["resolve"]), by_action["resolve"]
    rb = e["response"]["body"]
    if not (c and c.get("status") == "open" and rb["status"] == "resolved" and rb["answer"] == e["request"]["body"]["answer"]
            and rb["resolved_at"]):
        problems.append("resolve: must turn an open mushroom into resolved with answer and resolved_at")
    for e in (x for x in claims_c["examples"] if x["request"]["path"].endswith("/assign")):
        b, ref = e["response"]["body"], e["request"]["path"].split("/")[3]
        if ref not in {l["tab_ref"] for l in tree_leaves(trees[b["from_project_id"]])}:
            problems.append(f"assign {ref}: not a leaf of from_project_id")
        if b["assigned_by"] != "user" or b["pinned"] is not True:
            problems.append(f"assign {ref}: must be assigned_by user and pinned")
        if b["project_id"] in trees:
            if b["branch_label"] not in {br["label"] for br in trees[b["project_id"]]["branches"]}:
                problems.append(f"assign {ref}: branch {b['branch_label']} not in target tree")
        elif b["project_id"] not in e["introduces"]:
            problems.append(f"assign {ref}: new tree id must be introduced")
    e = next(x for x in claims_c["examples"] if x["request"]["path"] == "/api/notes")
    b = e["response"]["body"]
    if not (e["request"]["body"]["tab_ref"] in {f["tab_ref"] for f in grove["fog"]} and b["claim"]["provenance"] == "stated"
            and b["claim"]["user_note_id"] == b["note"]["id"]):
        problems.append("notes: must clear a fog tab and return a stated claim citing the new note")
    e = next(x for x in claims_c["examples"] if x["request"]["path"].endswith("/analyze"))
    pid = e["request"]["path"].split("/")[3]
    if pid not in trees or e["response"]["body"] != trees[pid]:
        problems.append("analyze: response must be the grove tree for that project, same shape")
    statuses = sorted(x["response"]["status"] for x in claims_c["examples"] if x["response"]["status"] >= 400)
    errs = [x for x in claims_c["examples"] if x["response"]["status"] >= 400]
    if statuses != [404, 422] or any(x["response"]["content_type"] != "application/problem+json" or
                                     not {"type", "title", "status", "detail"} <= x["response"]["body"].keys() for x in errs):
        problems.append(f"errors: need RFC 7807 404 and 422, got {statuses}")
    record("D. claims: confirm/edit/dismiss/resolve, assign (pinned), notes, analyze tree shape, RFC 7807 404 + 422", problems)

    # E. Work Context quotes are verbatim in the SAMPLE docs and in the submitted items.
    problems = []
    items = wc_c["examples"][0]["request"]["body"]["items"]
    item_text = {it["title"]: it["text"] for it in items}
    for it in items:
        if len(it["text"]) > 12_000:
            problems.append(f"item {it['title']}: {len(it['text'])} chars > 12,000")
        if (it["kind"] == "page") != ("domain" in it):
            problems.append(f"item {it['title']}: domain only on pages")
    if items_json != items:
        problems.append("upload items_json differs from the analyze items")
    cues = vtt_cues(docs["teams-transcript.vtt"])
    sourced = [c for c in claims_in(wc_resp) if c["provenance"] == "sourced"]
    for c in sourced:
        fname = WC_FILES.get(c["source"])
        if fname is None:
            problems.append(f"{c['id']}: unknown source {c['source']!r}")
            continue
        if c["quote"] not in docs[fname]:
            problems.append(f"{c['id']}: quote not verbatim in {fname}")
        if c["quote"] not in item_text[c["source"]]:
            problems.append(f"{c['id']}: quote not in the submitted item text")
        if fname.endswith(".vtt"):
            if not c["timestamp"] or not any(t.startswith(c["timestamp"]) and c["quote"] in txt for t, txt in cues):
                problems.append(f"{c['id']}: quote not in the cue at {c['timestamp']}")
        elif c["timestamp"] is not None:
            problems.append(f"{c['id']}: timestamp only for transcript quotes")
    record(f"E. work-context: {len(sourced)} quotes verbatim in their SAMPLE doc and item; transcript quotes in their cue", problems)

    # F. Work Context matches EXPECTED.json.
    problems = []
    exp_quotes = {}
    for d in dicts(expected):
        if "quote" in d:
            exp_quotes[d["quote"]] = d["source"]
    for c in sourced:
        if exp_quotes.get(c["quote"]) != WC_FILES.get(c["source"]):
            problems.append(f"{c['id']}: quote is not an EXPECTED.json quote from the same file")
    if wc_resp["project"] != expected["project"] or wc_resp["goal"]["text"] != expected["goal"]["text"]:
        problems.append("project/goal differ")
    d0, e0 = wc_resp["decisions"][0], expected["decisions"][0]
    if (d0["quote"], d0["timestamp"]) != (e0["quote"], e0["timestamp"]):
        problems.append("decision quote/timestamp differ")
    if wc_resp["blockers"][0]["text"] != expected["blockers"][0]["text"]:
        problems.append("blocker differs")
    if [(o["person"], o["task"], o["provenance"]) for o in wc_resp["owners"]] != \
       [(o["person"], o["task"], o["provenance"]) for o in expected["owners"]]:
        problems.append("owners differ")
    q = wc_resp["open_questions"][0]
    if q["text"] != expected["open_questions"][0]["text"] or q["status"] != "open":
        problems.append("open question differs")
    if [(a["rank"], a["text"]) for a in wc_resp["next_actions"]] != [(a["rank"], a["text"]) for a in expected["next_actions"]]:
        problems.append("next actions differ in text or rank")
    item_ids = {c["id"] for c in claims_in(wc_resp)}
    problems += [f"{a['id']}: unblocks {a['unblocks']} unknown" for a in wc_resp["next_actions"]
                 if a["unblocks"] is not None and a["unblocks"] not in item_ids]
    if wc_resp["next_actions"][2]["unblocks"] != wc_resp["blockers"][0]["id"]:
        problems.append("follow-up action must unblock the credentials blocker")
    if not any(c["provenance"] == "inferred" for c in claims_in(wc_resp)):
        problems.append("no inferred item (S needs both pills)")
    if not wc_resp["handoff_brief"].strip():
        problems.append("handoff_brief empty")
    if not any(x["response"]["status"] == 413 for x in wc_c["examples"]):
        problems.append("missing 413 example")
    record("F. work-context matches EXPECTED.json (goal, decision, blocker, owners, open question, 3 next actions); 413 example", problems)

    # G. Prune agrees with the grove.
    problems = []
    sug = {s["kind"]: s for s in prune_c["examples"][0]["response"]["body"]["suggestions"]}
    vines = {v["kind"]: v for t in grove["trees"] for v in t["vines"]}
    for kind, vk in (("exact_duplicate", "exact"), ("semantic_redundant", "semantic")):
        if (sug[kind]["tab_refs"], sug[kind]["keep_ref"]) != (vines[vk]["tab_refs"], vines[vk]["keep_ref"]):
            problems.append(f"{kind} differs from the {vk} vine")
    fallen = sorted(l["tab_ref"] for t in grove["trees"] for l in tree_leaves(t) if l["fallen"])
    if sorted(sug["stale"]["tab_refs"]) != fallen:
        problems.append("stale tabs differ from fallen leaves")
    if not set(sug["distraction"]["tab_refs"]) <= set(grove["meadow"]):
        problems.append("distraction tabs must be meadow tabs")
    actions = {a["id"] for a in prune_c["examples"][0]["response"]["body"]["actions"]}
    if actions != {"keep_all", "close_selected", "save_as_references", "prune_branch"}:
        problems.append(f"actions {actions}")
    if prune_c["examples"][0]["request"]["body"]["tab_refs"] != [t["tab_ref"] for t in tabs]:
        problems.append("request tab_refs differ from the snapshot")
    record("G. prune: exact + semantic pairs equal the vines; stale equals fallen leaves; distraction from meadow; 4 actions", problems)

    # H. Memory search agrees with the firefly.
    problems = []
    found, nf = (e["response"]["body"] for e in mem_c["examples"])
    m, ff = found["matches"][0], grove["fireflies"][0]
    if (m["project_id"], m["project"], m["date"], m["similarity"], m["saved_context_id"]) != \
       (ff["past_project_id"], ff["past_project_name"], ff["past_date"], ff["similarity"], ff["saved_context_id"]):
        problems.append("found match differs from the grove firefly")
    if not (found["found"] is True and all(x["similarity"] >= 0.78 for x in found["matches"])):
        problems.append("found matches must have similarity >= 0.78")
    if nf != {"found": False, "query": "recipe", "message": "No related research found", "matches": []}:
        problems.append(f"not-found body {nf}")
    record("H. memory: found match = firefly's past project (similarity ≥ 0.78); honest not-found", problems)

    # I. The generator is the single source and deterministic.
    problems = []
    digest = lambda: [hashlib.sha256(p.read_bytes()).hexdigest() for p in GENERATED]
    before = digest()
    runs = []
    for _ in range(2):
        proc = subprocess.run([sys.executable, "-W", "error", str(GENERATOR)], capture_output=True, text=True)
        if proc.returncode:
            problems.append(f"generator failed: {proc.stderr.strip()[-200:]}")
        runs.append(digest())
    if not (before == runs[0] == runs[1]):
        changed = [p.name for p, a, b in zip(GENERATED, before, runs[1]) if a != b]
        problems.append(f"files differ after regenerating: {changed}")
    record(f"I. generator run twice: identical hashes for all {len(GENERATED)} generated files, equal to the files on disk", problems)

    for ok, label, probs in results:
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        for p in probs:
            print(f"    - {p}")

    print("\n== Counts")
    for fname, contract in files.items():
        ex = contract["examples"]
        print(f"  {fname:<28} examples {len(ex)} · statuses {[e['response']['status'] for e in ex]} · "
              f"claims {len(claims_in(contract))} · introduced ids {sum(len(e['introduces']) for e in ex)}")
    print(f"  work-context items {len(items)} ({', '.join(f'{it['kind']} {len(it['text'])}' for it in items)} chars) · "
          f"sourced {len(sourced)} · inferred {sum(c['provenance'] == 'inferred' for c in claims_in(wc_resp))}")
    print(f"  prune suggestions {len(sug)} ({', '.join(f'{k} {len(s['tab_refs'])}' for k, s in sug.items())})")
    failed = sum(not ok for ok, _, _ in results)
    print(f"\n== Result: {'PASS' if not failed else f'FAIL ({failed} of {len(results)} checks failed)'} · "
          f"{len(results)} checks · contracts dir: {CONTRACTS.relative_to(REPO) if CONTRACTS.is_relative_to(REPO) else CONTRACTS}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
