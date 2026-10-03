"""Check the grove contracts against the demo tab set and the provenance rules.

Run from the repo root:
    apps\\api\\.venv\\Scripts\\python apps\\api\\app\\engine\\scripts\\check_grove_contract.py

Checks contracts/grove.example.json, contracts/grove.degraded.example.json and
contracts/grove.stream.example.ndjson. Exits non-zero if any check fails.
"""

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
CONTRACTS = REPO / "contracts"
GROVE_PATH = CONTRACTS / "grove.example.json"
DEGRADED_PATH = CONTRACTS / "grove.degraded.example.json"
STREAM_PATH = CONTRACTS / "grove.stream.example.ndjson"
TABS_PATH = REPO / "apps" / "api" / "app" / "engine" / "fixtures" / "demo_tabs.json"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SNAKE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
REF_KIND_TYPE = {"query": "search", "note": "note", "doc": "doc"}

results: list[tuple[bool, str, list[str]]] = []


def record(label: str, problems: list[str]) -> None:
    results.append((not problems, label, problems))


def tree_claims(tree: dict) -> list[tuple[str, dict]]:
    out = [("goal", tree["goal"])]
    if tree.get("direction"):
        out.append(("direction", tree["direction"]))
    for key in ("stones", "mushrooms", "next_actions", "hypotheses"):
        out += [(key, c) for c in tree[key]]
    return out


def tree_leaves(tree: dict) -> list[dict]:
    return [leaf for branch in tree["branches"] for leaf in branch["leaves"]]


def walk_keys(node, path="$"):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k, f"{path}.{k}"
            yield from walk_keys(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_keys(v, f"{path}[{i}]")


def check_grove(grove: dict, snap: dict, name: str, degraded: bool) -> None:
    trees = grove["trees"]
    note_ids = {c["user_note_id"] for t in trees for c in t["stones"] if c.get("user_note_id")}
    query_ids = {qf["id"] for t in trees for qf in t.get("query_families", [])}
    doc_ids: set[str] = set()

    # 1. Coverage: every snapshot tab placed; nothing invented.
    problems = []
    placements: dict[str, list[str]] = {}
    for tree in trees:
        for leaf in tree_leaves(tree):
            placements.setdefault(leaf["tab_ref"], []).append(f"tree:{tree['name']}")
            src = snap.get(leaf["tab_ref"])
            if src is None:
                problems.append(f"leaf {leaf['tab_ref']} not in demo_tabs.json")
            elif (leaf["title"], leaf["domain"]) != (src["title"], src["domain"]):
                problems.append(f"leaf {leaf['tab_ref']} title/domain differs from snapshot")
    for sprout in grove["sprouts"]:
        for ref in sprout["tab_refs"]:
            placements.setdefault(ref, []).append("sprout")
    for ref in grove["meadow"]:
        placements.setdefault(ref, []).append("meadow")
    for f in grove["fog"]:
        placements.setdefault(f["tab_ref"], []).append("fog")
    problems += [f"{ref} placed nowhere" for ref in snap if ref not in placements]
    problems += [f"{ref} invented (not in snapshot)" for ref in placements if ref not in snap]
    shared = {ref for t in trees for ref in t["shared_tab_refs"]}
    for ref, where in placements.items():
        if len(where) > 1 and ref not in shared:
            problems.append(f"{ref} placed {len(where)} times but not declared shared: {where}")
    record(f"{name} 1. all {len(snap)} snapshot tabs placed in a leaf/sprout/meadow/fog; nothing invented", problems)

    # 2. Evidence refs resolve within the same tree.
    problems = []
    for tree in trees:
        leaf_refs = {leaf["tab_ref"] for leaf in tree_leaves(tree)}
        for kind, c in tree_claims(tree):
            for e in c["evidence"]:
                ok = {
                    "tab": UUID.match(e["ref"]) and e["ref"] in leaf_refs,
                    "note": e["ref"] in note_ids,
                    "query": e["ref"] in query_ids,
                    "doc": e["ref"] in doc_ids,
                }.get(e["ref_kind"], False)
                if not ok:
                    problems.append(f"{tree['name']} {kind} {c['id']}: {e['ref_kind']} ref {e['ref']} does not resolve")
        for ref in tree["important_tab_refs"] + tree["shared_tab_refs"]:
            if ref not in leaf_refs:
                problems.append(f"{tree['name']}: listed ref {ref} is not a leaf of this tree")
        for vine in tree["vines"]:
            for ref in vine["tab_refs"] + [vine["keep_ref"]]:
                if ref not in leaf_refs:
                    problems.append(f"{tree['name']}: vine ref {ref} is not a leaf of this tree")
    record(f"{name} 2. every evidence ref is a leaf of the same tree, or a defined note/query/doc id", problems)

    # 3. Provenance rules.
    problems = []
    for tree in trees:
        for kind, c in tree_claims(tree):
            p, conf = c["provenance"], c["confidence"]
            tag = f"{tree['name']} {kind} {c['id']}"
            if p == "stated" and c.get("user_note_id") not in note_ids:
                problems.append(f"{tag}: stated without user_note_id")
            elif p == "sourced" and not c.get("quote"):
                problems.append(f"{tag}: sourced without quote")
            elif p == "inferred" and (len(c["evidence"]) < 2 or conf < 0.60):
                problems.append(f"{tag}: inferred needs >= 2 evidence and confidence >= 0.60")
            if p != "stated" and conf < 0.60 and p != "hypothesis":
                problems.append(f"{tag}: confidence {conf} < 0.60 but provenance {p}")
            if p not in {"stated", "sourced", "inferred", "hypothesis"}:
                problems.append(f"{tag}: unknown provenance {p}")
    record(f"{name} 3. provenance rules (stated→note, sourced→quote, inferred→≥2 refs & ≥0.60, <0.60→hypothesis)", problems)

    # 4. Confidence cap.
    problems = []
    for tree in trees:
        leaf_type = {leaf["tab_ref"]: leaf["source_type"] for leaf in tree_leaves(tree)}
        for kind, c in tree_claims(tree):
            if c["provenance"] == "stated":
                continue
            refs = len(c["evidence"])
            types = {leaf_type.get(e["ref"]) if e["ref_kind"] == "tab" else REF_KIND_TYPE[e["ref_kind"]] for e in c["evidence"]}
            cap = min(0.95, 0.35 + 0.15 * refs + 0.10 * len(types))
            if c["confidence"] > cap + 1e-9:
                problems.append(f"{tree['name']} {kind} {c['id']}: {c['confidence']} > cap {cap:.2f}")
    record(f"{name} 4. confidence <= min(0.95, 0.35 + 0.15·refs + 0.10·source types) for every non-stated claim", problems)

    # 5. Display wording.
    problems = []
    for tree in trees:
        for kind, c in tree_claims(tree):
            p, d = c["provenance"], c["display_text"]
            if p == "inferred" and not re.search(r"\b(appears|likely)\b", d, re.IGNORECASE):
                problems.append(f"{c['id']}: inferred display lacks appears/likely: {d!r}")
            elif p == "hypothesis" and not d.startswith("Maybe:"):
                problems.append(f"{c['id']}: hypothesis display must start 'Maybe:': {d!r}")
            elif p in {"stated", "sourced"} and d != c["text"]:
                problems.append(f"{c['id']}: {p} display must equal text")
    record(f"{name} 5. display_text wording matches provenance", problems)

    # 6. Shared tab, exact dup, unblocks, amber job tree.
    problems = []
    for ref in shared:
        holders = [t["name"] for t in trees if ref in {leaf["tab_ref"] for leaf in tree_leaves(t)}]
        if len(holders) != 2:
            problems.append(f"shared {ref} is a leaf in {holders}")
    if not shared:
        problems.append("no shared tab declared")
    exact = [v for t in trees for v in t["vines"] if v["kind"] == "exact"]
    if not exact:
        problems.append("no exact-duplicate vine")
    for v in exact:
        if len({snap[r]["dup_key"] for r in v["tab_refs"]}) != 1:
            problems.append(f"exact vine {v['tab_refs']} has different dup_keys")
    for v in (v for t in trees for v in t["vines"] if v["kind"] == "semantic"):
        if len({snap[r]["dup_key"] for r in v["tab_refs"]}) != len(v["tab_refs"]):
            problems.append(f"semantic vine {v['tab_refs']} shares a dup_key (should be exact)")
    mushroom_ids = {m["id"] for t in trees for m in t["mushrooms"]}
    for t in trees:
        for a in t["next_actions"]:
            if a["unblocks"] not in mushroom_ids:
                problems.append(f"next action {a['id']} unblocks unknown {a['unblocks']}")
    job = [t for t in trees if t["project_id"] == JOB_PROJECT_ID]
    if not job or job[0]["canopy"] != "amber" or job[0]["days_since_active"] < 3:
        problems.append("Job Search tree must be amber with days_since_active >= 3")
    record(f"{name} 6. shared tab in two trees; exact pair shares dup_key; unblocks → real mushroom; job tree amber", problems)

    # 7. Snake case keys (JSON validity is proven by loading the file).
    record(f"{name} 7. JSON valid and every key snake_case",
           [f"{path}: {k}" for k, path in walk_keys(grove) if not SNAKE.match(k)])

    # 8. Mode rules.
    problems = []
    if degraded:
        if grove["degraded"] is not True:
            problems.append("degraded must be true")
        if not grove.get("banner_text"):
            problems.append("banner_text missing")
        if grove["fireflies"]:
            problems.append("fireflies must be empty")
        for t in trees:
            if not t["fogged"]:
                problems.append(f"{t['name']}: tree must be fogged")
            for key in ("stones", "mushrooms", "next_actions"):
                if t[key]:
                    problems.append(f"{t['name']}: {key} must be empty")
            problems += [f"{t['name']} {k} {c['id']}: provenance {c['provenance']}, must be hypothesis"
                         for k, c in tree_claims(t) if c["provenance"] != "hypothesis"]
        label = "every claim hypothesis; no stones/mushrooms/next_actions/fireflies; all fogged; degraded true; banner"
    else:
        if grove["degraded"] is not False or grove.get("banner_text") is not None:
            problems.append("normal grove must have degraded false and banner_text null")
        label = "degraded false, banner_text null"
    record(f"{name} 8. mode: {label}", problems)

    # 9. Mushroom status fields.
    problems = []
    for t in trees:
        for m in t["mushrooms"]:
            if m["status"] == "resolved" and not (m.get("answer") and m.get("resolved_at")):
                problems.append(f"{m['id']}: resolved needs answer and resolved_at")
            elif m["status"] == "open" and not ("answer" in m and "resolved_at" in m and m["answer"] is None and m["resolved_at"] is None):
                problems.append(f"{m['id']}: open needs answer null and resolved_at null")
            elif m["status"] not in {"open", "resolved"}:
                problems.append(f"{m['id']}: unknown status {m['status']}")
    shapes = {tuple(m.keys()) for t in trees for m in t["mushrooms"]}
    if len(shapes) > 1:
        problems.append(f"mushrooms have different key sets: {shapes}")
    statuses = sorted(m["status"] for t in trees for m in t["mushrooms"])
    if not degraded and statuses != ["open", "resolved"]:
        problems.append(f"expected one open and one resolved mushroom, got {statuses}")
    record(f"{name} 9. resolved mushroom has answer + resolved_at; open has both null; same shape", problems)


def membership(trees_or_clusters: list[dict], from_clusters: bool = False) -> dict[str, list[str]]:
    if from_clusters:
        return {c["project_id"]: c["tab_refs"] for c in trees_or_clusters}
    return {t["project_id"]: [leaf["tab_ref"] for leaf in tree_leaves(t)] for t in trees_or_clusters}


def check_stream(lines_text: str, grove: dict, degraded_grove: dict, snap: dict) -> None:
    name = "grove.stream"
    problems = []
    raw = lines_text.split("\n")
    if raw and raw[-1] == "":
        raw = raw[:-1]
    lines = []
    for i, line in enumerate(raw, 1):
        if not line.strip():
            problems.append(f"line {i} is blank")
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            problems.append(f"line {i} does not parse: {exc}")
            continue
        if not isinstance(obj, dict):
            problems.append(f"line {i} is not a JSON object")
        lines.append(obj)
    record(f"{name} 1. {len(raw)} lines, each one complete JSON object, no blank lines", problems)

    types = [l.get("type") for l in lines]
    ok = types and types[0] == "clusters" and types[-1] == "done" and all(t == "tree" for t in types[1:-1])
    record(f"{name} 2. order clusters → tree × {types.count('tree')} → done", [] if ok else [f"types: {types}"])

    first, last = lines[0], lines[-1]
    tree_lines = [{k: v for k, v in l.items() if k != "type"} for l in lines if l.get("type") == "tree"]
    by_id = {t["project_id"]: t for t in tree_lines}
    problems = []
    if len(by_id) != len(grove["trees"]):
        problems.append(f"{len(by_id)} tree lines for {len(grove['trees'])} trees")
    for t in grove["trees"]:
        if by_id.get(t["project_id"]) != t:
            problems.append(f"tree line for {t['name']} differs from grove.example.json")
    record(f"{name} 3. tree lines reassembled equal grove.example.json trees", problems)

    problems = []
    for c in first["clusters"]:
        problems += [f"cluster {c['name']}: {ref} not in demo_tabs.json" for ref in c["tab_refs"] if ref not in snap]
        if "goal" in c or "stones" in c or "mushrooms" in c:
            problems.append(f"cluster {c['name']} carries claims")
    for key in ("sprouts", "meadow", "fog"):
        if first[key] != grove[key]:
            problems.append(f"clusters line {key} differs from grove.example.json")
        problems += [f"{key}: {r} not in demo_tabs.json" for r in _refs(first[key]) if r not in snap]
    record(f"{name} 4. every tab_ref in the clusters line exists in demo_tabs.json; no claims", problems)

    problems = []
    tree_members = membership(grove["trees"])
    for pid, refs in membership(first["clusters"], from_clusters=True).items():
        if tree_members.get(pid) != refs:
            problems.append(f"cluster {pid}: tab_refs differ from the tree's leaves")
    if set(tree_members) != {c["project_id"] for c in first["clusters"]}:
        problems.append("cluster project_ids differ from tree project_ids")
    for c in first["clusters"]:
        t = next(t for t in grove["trees"] if t["project_id"] == c["project_id"])
        if (c["attention_min"], c["days_since_active"], c["canopy"]) != (t["attention_min"], t["days_since_active"], t["canopy"]):
            problems.append(f"cluster {c['name']}: attention/days/canopy differ from tree")
        if c["name"] == t["name"]:
            problems.append(f"cluster {c['name']}: uses the AI name, should be the deterministic label")
    record(f"{name} 5. cluster tab_refs per project match the tree's leaves; deterministic names", problems)

    problems = []
    if first.get("run_id") != grove["run_id"] or last.get("run_id") != grove["run_id"]:
        problems.append("run_id differs between lines and grove.example.json")
    if first.get("hollow_count") != grove["hollow_count"]:
        problems.append("hollow_count differs")
    if last.get("degraded") is not False or last.get("fireflies") != grove["fireflies"]:
        problems.append("done line must have degraded false and the grove's fireflies")
    record(f"{name} 6. run_id, hollow_count, done.degraded and done.fireflies match grove.example.json", problems)

    problems = []
    if membership(degraded_grove["trees"]) != tree_members:
        problems.append("degraded cluster membership differs from grove.example.json")
    for key in ("sprouts", "meadow", "fog"):
        if degraded_grove[key] != grove[key]:
            problems.append(f"degraded {key} differs")
    deg_names = {t["project_id"]: t["name"] for t in degraded_grove["trees"]}
    for c in first["clusters"]:
        if deg_names.get(c["project_id"]) != c["name"]:
            problems.append(f"cluster label {c['name']!r} differs from Seedling tree name {deg_names.get(c['project_id'])!r}")
    record("grove.degraded 10. same tab_refs and cluster membership as grove.example.json; labels = stream cluster names", problems)


def _refs(node) -> list[str]:
    if isinstance(node, str):
        return [node] if UUID.match(node) else []
    if isinstance(node, dict):
        return [r for v in node.values() for r in _refs(v)]
    if isinstance(node, list):
        return [r for v in node for r in _refs(v)]
    return []


def counts(grove: dict, name: str) -> None:
    trees = grove["trees"]
    claims = [c for t in trees for _, c in tree_claims(t)]
    by_prov: dict[str, int] = {}
    for c in claims:
        by_prov[c["provenance"]] = by_prov.get(c["provenance"], 0) + 1
    print(f"\n== Counts: {name}")
    print(f"trees: {len(trees)} · sprouts: {len(grove['sprouts'])} · meadow: {len(grove['meadow'])} · "
          f"fog: {len(grove['fog'])} · fireflies: {len(grove['fireflies'])} · degraded: {grove['degraded']} · "
          f"banner_text: {grove['banner_text']!r}")
    for t in trees:
        print(f"  {t['name']:<30} branches {len(t['branches'])} · leaves {len(tree_leaves(t)):>2} · claims {len(tree_claims(t))} · "
              f"stones {len(t['stones'])} · mushrooms {len(t['mushrooms'])} · vines {len(t['vines'])} · "
              f"canopy {t['canopy']} · fogged {t['fogged']}")
    print(f"leaves total: {sum(len(tree_leaves(t)) for t in trees)} (shared tab counted per tree) · "
          f"claims total: {len(claims)} · by provenance: {dict(sorted(by_prov.items()))}")


JOB_PROJECT_ID = ""


def main() -> int:
    global JOB_PROJECT_ID
    try:
        tabs = json.loads(TABS_PATH.read_text(encoding="utf-8"))["open_tabs"]
        grove = json.loads(GROVE_PATH.read_text(encoding="utf-8"))
        degraded = json.loads(DEGRADED_PATH.read_text(encoding="utf-8"))
        stream_text = STREAM_PATH.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[FAIL] could not load contracts: {exc}")
        return 1
    snap = {t["tab_ref"]: t for t in tabs}
    JOB_PROJECT_ID = next(t["project_id"] for t in grove["trees"] if t["name"] == "Job Search")

    check_grove(grove, snap, "grove", degraded=False)
    check_grove(degraded, snap, "grove.degraded", degraded=True)
    check_stream(stream_text, grove, degraded, snap)

    for ok, label, problems in results:
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        for p in problems:
            print(f"    - {p}")

    counts(grove, "grove.example.json")
    counts(degraded, "grove.degraded.example.json")
    stream = [json.loads(l) for l in stream_text.splitlines() if l.strip()]
    print("\n== Stream: grove.stream.example.ndjson")
    for i, l in enumerate(stream, 1):
        detail = {
            "clusters": lambda: f"{len(l['clusters'])} clusters: " + ", ".join(f"{c['name']} ({len(c['tab_refs'])})" for c in l["clusters"]),
            "tree": lambda: f"{l['name']} ({len(tree_leaves(l))} leaves)",
            "done": lambda: f"degraded {l['degraded']} · fireflies {len(l['fireflies'])}",
        }[l["type"]]()
        print(f"  line {i}: {l['type']:<8} {detail}")

    failed = sum(not ok for ok, _, _ in results)
    print(f"\n== Result: {'PASS' if not failed else f'FAIL ({failed} of {len(results)} checks failed)'} · {len(results)} checks")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
