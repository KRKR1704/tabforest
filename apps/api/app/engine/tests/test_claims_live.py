"""R-9/R-10 live: real Azure OpenAI + real Tiger Cloud, the 28 demo tabs, standalone app over HTTP.

Test users …00ee (the user) and …00ef (another user); every row of both is deleted at the end and the
test asserts 0 left. Run with -s to read the round-trip log (HTTP status and the changed field per call).

Order matters (one story): good grow -> wrong key (Seedling, GET still returns the good grove) ->
3 tabs -> scripted round trip -> analyze -> cross-user 404s -> re-grow keeps what the user did.
"""

import asyncio
import json
import time
import uuid

import asyncpg
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.engine import routes
from app.engine.aoai import AzureOpenAIClient
from app.engine.carry import similar
from app.engine.fixtures import load_demo_tabs
from app.engine.schemas import GroveResponse, stream_line_adapter
from app.engine.settings import get_settings
from app.engine.standalone import app

settings = get_settings()
pytestmark = pytest.mark.skipif(not (settings.aoai_configured and settings.db_configured),
                                reason="AZURE_OPENAI_API_KEY or DATABASE_URL not set")
EE = uuid.UUID("00000000-0000-4000-8000-0000000000ee")
EF = uuid.UUID("00000000-0000-4000-8000-0000000000ef")
H, H_OTHER = {"X-Dev-User": str(EE)}, {"X-Dev-User": str(EF)}
DEMO = load_demo_tabs()
BODY = {"open_tabs": DEMO["open_tabs"], "hollow_count": 3, "snapshot_at": DEMO["snapshot_at"]}
TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches", "user_notes",
          "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings")
POMODORO = "Use a Pomodoro timer for focused work blocks"
SPONSOR = "Hackathon sponsor docs"


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


async def _sql(fn):
    conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
    try:
        return await fn(conn)
    finally:
        await conn.close()


async def _clean(conn) -> dict[str, int]:
    for user in (EE, EF):
        for t in TABLES:
            await conn.execute(f"DELETE FROM {t} WHERE user_id = $1", user)
    return {t: await conn.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = ANY($1::uuid[])", [EE, EF]) for t in TABLES}


def leaves(tree: dict) -> list[str]:
    return [l["tab_ref"] for b in tree["branches"] for l in b["leaves"]]


def tree_of(grove: dict, tab: int) -> dict | None:
    return next((t for t in grove["trees"] if tid(tab) in leaves(t)), None)


@pytest.fixture(scope="module")
def client():
    asyncio.run(_sql(_clean))
    real = routes.AzureOpenAIClient
    routes.limiter.reset()
    mp = pytest.MonkeyPatch()
    mp.setattr(routes, "get_settings", lambda: settings.model_copy(update={"auth_mode": "dev"}))  # honors snapshot_at
    with TestClient(app) as c:
        yield c, mp, real
    mp.undo()
    left = asyncio.run(_sql(_clean))
    print(f"\ncleanup: rows left for users …00ee and …00ef: {left} (total {sum(left.values())})")
    assert sum(left.values()) == 0


STORY: dict = {}   # what one test learns for the next


def log(step: str, r, changed: str) -> None:
    print(f"  {step:<44} HTTP {r.status_code}  {changed}")


def test_01_good_grow_is_the_baseline(client) -> None:
    c, _, _ = client
    r = c.post("/api/grove/grow", json=BODY, headers=H)
    assert r.status_code == 200, r.text
    grove = GroveResponse.model_validate(r.json()).model_dump(mode="json")
    assert grove["degraded"] is False and len(grove["trees"]) >= 3
    STORY["good"] = r.json()
    print(f"\ngood grow {grove['run_id']}: trees {[t['name'] for t in grove['trees']]}")


def test_02_wrong_key_is_seedling_and_get_still_returns_the_good_grove(client) -> None:
    c, mp, _ = client
    mp.setattr(routes, "AzureOpenAIClient", lambda: AzureOpenAIClient(
        settings=settings.model_copy(update={"azure_openai_api_key": SecretStr("not-a-valid-key")})))
    r = c.post("/api/grove/grow", json=BODY, headers=H)
    assert r.status_code == 200, r.text
    down = GroveResponse.model_validate(r.json()).model_dump(mode="json")
    assert down["degraded"] is True and down["banner_text"] == "AI unavailable — showing groups only"
    assert down["fireflies"] == [] and down["trees"]
    for t in down["trees"]:
        assert t["fogged"] and t["goal"]["display_text"].startswith("Maybe: tabs about ")
        assert t["goal"]["confidence"] <= 0.59 and t["stones"] == t["mushrooms"] == t["next_actions"] == []
    print(f"\nwrong key: HTTP 200, degraded, banner {down['banner_text']!r}, trees {[t['name'] for t in down['trees']]}")

    stamps = []
    t0 = time.perf_counter()
    with c.stream("POST", "/api/grove/grow?stream=1", json=BODY, headers=H) as s:
        assert s.status_code == 200
        for line in s.iter_lines():
            if line.strip():
                stamps.append((round(time.perf_counter() - t0, 3), json.loads(line)))
    for _, line in stamps:
        stream_line_adapter.validate_python(line)
    kinds = [l["type"] for _, l in stamps]
    print("wrong key, stream:\n" + "\n".join(f"  {t:7.3f}s  {l['type']:<8} {l.get('name', '')}" for t, l in stamps))
    assert kinds[0] == "clusters" and kinds[-1] == "done" and set(kinds[1:-1]) == {"tree"}
    assert stamps[-1][1]["degraded"] is True and all(l["fogged"] for _, l in stamps if l["type"] == "tree")

    got = c.get("/api/grove", headers=H)
    assert got.status_code == 200 and got.json()["run_id"] == STORY["good"]["run_id"] and got.json()["degraded"] is False
    print(f"GET /api/grove while Azure is down: run {got.json()['run_id']} = the earlier good grove")

    # Embeddings fail too (titles never seen, so nothing is cached): term-overlap clustering, no model call.
    fresh = [{**t, "title": f"{t['title']} (copy {i})"} for i, t in enumerate(DEMO["open_tabs"])]
    r = c.post("/api/grove/grow", json={**BODY, "open_tabs": fresh}, headers=H)
    assert r.status_code == 200
    emb = r.json()
    assert emb["degraded"] is True and emb["fireflies"] == [] and all(t["fogged"] for t in emb["trees"])

    async def rows(conn):
        return await conn.fetch("SELECT degraded, fallback_used, llm_calls, clusters FROM analysis_runs "
                                "WHERE user_id = $1 AND run_id = $2", EE, uuid.UUID(emb["run_id"][2:]))
    row = asyncio.run(_sql(rows))[0]
    print(f"embeddings down: degraded={row['degraded']} fallback_used={row['fallback_used']} llm_calls={row['llm_calls']} "
          f"clusters={row['clusters']} trees={[t['name'] for t in emb['trees']]}")
    assert (row["degraded"], row["fallback_used"], row["llm_calls"]) == (True, True, 0)
    mp.setattr(routes, "AzureOpenAIClient", client[2])
    assert c.get("/api/grove", headers=H).json()["run_id"] == STORY["good"]["run_id"]


def test_03_three_tabs_are_sprouts_with_at_most_one_model_call(client) -> None:
    c, _, _ = client
    three = [t for t in DEMO["open_tabs"] if int(t["tab_ref"][-12:]) in (1, 3, 4)]
    r = c.post("/api/grove/grow", json={**BODY, "open_tabs": three}, headers=H)
    assert r.status_code == 200
    grove = GroveResponse.model_validate(r.json()).model_dump(mode="json")
    assert grove["trees"] == [] and len(grove["sprouts"]) == 1 and grove["banner_text"] == "TabForest learns as you browse"
    assert grove["sprouts"][0]["tab_refs"] == [tid(1), tid(3), tid(4)]

    async def calls(conn):
        return await conn.fetchval("SELECT llm_calls FROM analysis_runs WHERE user_id = $1 AND run_id = $2", EE,
                                   uuid.UUID(grove["run_id"][2:]))
    n = asyncio.run(_sql(calls))
    print(f"\n3 tabs: sprout label {grove['sprouts'][0]['label']!r}, LLM calls {n}, banner {grove['banner_text']!r}")
    assert n <= 1
    # Put the full grove back as the last one (a 3-tab run is the newest full grove now).
    again = c.post("/api/grove/grow", json=BODY, headers=H)
    assert again.status_code == 200 and not again.json()["degraded"]
    STORY["good"] = again.json()


ROUND_TRIP_ATTEMPTS = 3


def test_04_scripted_round_trip(client) -> None:
    """Flaky on purpose, and only this test: the round trip failed in about 3 of 18 live runs and passed the rest.
    It asks the real model for a grove and then needs that grove to contain a stone or direction to confirm, a next
    action to edit, a hypothesis to dismiss and an open question to resolve; the cause of the rare failure was not
    isolated and is treated as model variance. No validator rule is loosened. A failed attempt leaves notes, pins
    and claims behind, so each retry starts from a clean user and a fresh grow. Up to 3 attempts; the last error
    is raised."""
    c = client[0]
    for attempt in range(1, ROUND_TRIP_ATTEMPTS + 1):
        try:
            _round_trip_once(c)
            return
        except Exception as exc:  # noqa: BLE001 - any failure of an attempt: retry from a clean state
            print(f"\nround trip attempt {attempt}/{ROUND_TRIP_ATTEMPTS} failed: {type(exc).__name__}: {str(exc)[:160]}")
            if attempt == ROUND_TRIP_ATTEMPTS:
                raise
            asyncio.run(_sql(_clean))
            routes.limiter.reset()
            r = c.post("/api/grove/grow", json=BODY, headers=H)
            assert r.status_code == 200, r.text
            STORY["good"] = r.json()


def _round_trip_once(c) -> None:
    grove = STORY["good"]
    auth = tree_of(grove, 1)
    print(f"\nround trip on {grove['run_id']} (Backend Auth tree {auth['name']!r}, project {auth['project_id']})")

    # 1. confirm the mossy/inferred stone, or the direction if there is none
    stone = next((s for s in auth["stones"] if s["kind"] == "mossy"), None)
    target = stone or auth["direction"] or next((h for h in auth["hypotheses"] if h["id"].startswith(("dec_", "dir_"))), None)
    assert target, "the real grove has no stone, direction or decision hypothesis to confirm"
    r = c.patch(f"/api/claims/{target['id']}", json={"action": "confirm"}, headers=H)
    assert r.status_code == 200, r.text
    confirmed = r.json()
    assert confirmed["provenance"] == "stated" and confirmed["confidence"] == 1.0 and confirmed["user_note_id"]
    if "kind" in confirmed:
        assert confirmed["kind"] == "carved"
    log("PATCH confirm " + target["id"][:8], r, f"provenance {target['provenance']} -> stated"
        + (f", kind {target.get('kind')} -> carved" if "kind" in confirmed else "") + f"; note {confirmed['user_note_id'][:10]}")
    STORY["confirmed_text"] = confirmed["text"]

    # 2. edit a next action
    action = next((a for a in auth["next_actions"]), None) or next((h for h in auth["hypotheses"] if h["id"].startswith("a_")), None)
    assert action, "the real grove has no next action"
    new_text = "Prototype the refresh-token flow with HttpOnly, Secure, SameSite=Strict cookies"
    r = c.patch(f"/api/claims/{action['id']}", json={"action": "edit", "text": new_text}, headers=H)
    assert r.status_code == 200 and r.json()["text"] == new_text and r.json()["provenance"] == "stated"
    log("PATCH edit next action", r, f"text {action['text'][:34]!r} -> {new_text[:34]!r}..., provenance {action['provenance']} -> stated")

    # 3. dismiss a hypothesis
    hyp = next((h for h in auth["hypotheses"] if h["id"] != action["id"] and h["id"] != target["id"]), None)
    assert hyp, "the real grove has no hypothesis to dismiss"
    r = c.patch(f"/api/claims/{hyp['id']}", json={"action": "dismiss"}, headers=H)
    assert r.status_code == 200 and r.json()["status"] == "dismissed"
    log("PATCH dismiss hypothesis", r, f"{hyp['display_text'][:50]!r} -> status dismissed, dismissed_at set")
    STORY["dismissed_text"] = hyp["text"]

    # 4. resolve the refresh-token mushroom
    q = next(m for m in auth["mushrooms"] if m["status"] == "open")
    answer = "Keep the refresh token in an HttpOnly, Secure, SameSite=Strict cookie; keep the access token in memory"
    r = c.patch(f"/api/claims/{q['id']}", json={"action": "resolve", "answer": answer}, headers=H)
    assert r.status_code == 200 and r.json()["status"] == "resolved" and r.json()["answer"] == answer
    log("PATCH resolve mushroom", r, f"status open -> resolved, answer set, resolved_at {r.json()['resolved_at']}")
    STORY["question_text"] = q["text"]

    # 5. assign tab 13 to a new tree
    r = c.post(f"/api/tabs/{tid(13)}/assign", json={"new_project_name": SPONSOR}, headers=H)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["pinned"] and a["assigned_by"] == "user" and a["project_name"] == SPONSOR and a["branch_label"] is None
    log("POST assign tab 13 -> new tree", r, f"project {a['from_project_id'][:10]} -> {a['project_id'][:10]} ({SPONSOR!r}), pinned")
    STORY["sponsor_project"] = a["project_id"]

    # 6. clear the fog on tab 28
    where = "fog" if any(f["tab_ref"] == tid(28) for f in grove["fog"]) else "a tree or the meadow"
    r = c.post("/api/notes", json={"kind": "goal", "tab_ref": tid(28), "text": POMODORO}, headers=H)
    assert r.status_code == 201, r.text
    n = r.json()
    assert n["claim"]["provenance"] == "stated" and n["note"]["kind"] == "goal"
    log("POST notes: clear the fog on tab 28", r, f"tab 28 from {where} -> stated goal {POMODORO[:30]!r}..., project {n['project_id'][:10]}")
    STORY["pomodoro_project"] = n["project_id"]

    # 7. GET /api/grove reflects all of it
    got = c.get("/api/grove", headers=H)
    assert got.status_code == 200
    now = GroveResponse.model_validate(got.json()).model_dump(mode="json")
    a_now = tree_of(now, 1)
    assert target["id"] in [s["id"] for s in a_now["stones"] + ([a_now["direction"]] if a_now["direction"] else [])] \
        or target["id"] in [s["id"] for s in a_now["stones"]]
    assert next(x for x in a_now["next_actions"] + a_now["hypotheses"] if x["id"] == action["id"])["text"] == new_text
    assert hyp["id"] not in [h["id"] for h in a_now["hypotheses"]]
    assert next(m for m in a_now["mushrooms"] if m["id"] == q["id"])["status"] == "resolved"
    sponsor = next(t for t in now["trees"] if t["name"] == SPONSOR)
    assert leaves(sponsor) == [tid(13)] and tid(13) not in leaves(next(t for t in now["trees"] if t["project_id"] == a["from_project_id"]))
    pom = next(t for t in now["trees"] if t["project_id"] == n["project_id"])
    assert pom["goal"]["text"] == POMODORO and pom["goal"]["provenance"] == "stated" and not pom["fogged"]
    assert not any(f["tab_ref"] == tid(28) for f in now["fog"])
    log("GET /api/grove", got, "reflects: stone carved, action edited, hypothesis gone, flower, 2 new trees, fog cleared")
    STORY["now"] = got.json()


def test_05_analyze_one_project(client) -> None:
    c, _, _ = client
    auth = tree_of(STORY["now"], 1)
    r = c.post(f"/api/projects/{auth['project_id']}/analyze", headers=H)
    assert r.status_code == 200, r.text
    tree = r.json()
    assert tree["project_id"] == auth["project_id"]
    assert any(s["kind"] == "carved" and s["text"] == STORY["confirmed_text"] for s in tree["stones"]) or \
        tree["direction"] and tree["direction"]["text"] == STORY["confirmed_text"] or \
        any(similar(s["text"], STORY["confirmed_text"]) for s in tree["stones"] if s["kind"] == "carved")
    assert not any(similar(h["text"], STORY["dismissed_text"]) and h["provenance"] != "stated"
                   for h in tree["hypotheses"] + tree["next_actions"] + tree["stones"])
    assert any(m["status"] == "resolved" for m in tree["mushrooms"]) or not tree["mushrooms"]
    got = c.get("/api/grove", headers=H).json()
    assert tree_of(got, 1)["goal"]["id"] == tree["goal"]["id"]
    print(f"\nPOST analyze {auth['project_id'][:12]}: HTTP {r.status_code}, tree {tree['name']!r}, stones "
          f"{[(s['kind'], s['provenance']) for s in tree['stones']]}, mushrooms {[m['status'] for m in tree['mushrooms']]}")
    STORY["now"] = got


def test_06_another_user_gets_404_for_every_id(client) -> None:
    c, _, _ = client
    auth = tree_of(STORY["now"], 1)
    ids = [auth["goal"]["id"]] + [s["id"] for s in auth["stones"]] + [m["id"] for m in auth["mushrooms"]] \
        + [a["id"] for a in auth["next_actions"]] + [h["id"] for h in auth["hypotheses"]]
    if auth["direction"]:
        ids.append(auth["direction"]["id"])
    results = []
    for claim_id in ids:
        for body in ({"action": "confirm"}, {"action": "dismiss"}):
            r = c.patch(f"/api/claims/{claim_id}", json=body, headers=H_OTHER)
            assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem+json"), claim_id
            results.append(r.status_code)
    for method, path, body in (("post", f"/api/tabs/{tid(13)}/assign", {"project_id": auth["project_id"]}),
                               ("post", f"/api/tabs/{tid(13)}/assign", {"new_project_name": "x"}),
                               ("post", "/api/notes", {"kind": "goal", "tab_ref": tid(28), "text": "x"}),
                               ("post", "/api/notes", {"kind": "note", "project_id": auth["project_id"], "text": "x"}),
                               ("post", f"/api/projects/{auth['project_id']}/analyze", None),
                               ("post", f"/api/projects/{STORY['sponsor_project']}/analyze", None)):
        r = getattr(c, method)(path, headers=H_OTHER, **({"json": body} if body is not None else {}))
        assert r.status_code == 404, (path, r.text)
        results.append(r.status_code)
    assert c.get("/api/grove", headers=H_OTHER).status_code == 404                    # no grove of their own
    print(f"\ncross-user: user …00ef got {results.count(404)} x 404 of {len(results)} calls on user …00ee's ids "
          f"({len(ids)} claim ids x confirm/dismiss + assign, notes, analyze); GET /api/grove -> 404")
    assert set(results) == {404}
    # nothing of …00ee's changed
    assert c.get("/api/grove", headers=H).json() == STORY["now"]


def test_07_regrow_keeps_what_the_user_did(client) -> None:
    c, _, _ = client
    r = c.post("/api/grove/grow", json=BODY, headers=H)
    assert r.status_code == 200, r.text
    grove = GroveResponse.model_validate(r.json()).model_dump(mode="json")
    assert grove["degraded"] is False
    a = tree_of(grove, 1)
    carved = [s for s in a["stones"] if s["kind"] == "carved"]
    kept_stone = any(similar(s["text"], STORY["confirmed_text"]) for s in carved) or \
        (a["direction"] and a["direction"]["provenance"] == "stated")
    sponsor = next((t for t in grove["trees"] if t["name"] == SPONSOR), None)
    other13 = [t["name"] for t in grove["trees"] if tid(13) in leaves(t) and t["name"] != SPONSOR]
    # A dismissed claim is not suggested again; a claim the user stated (the carved stone) is never filtered,
    # even when it reads like the dismissed one (the model often says "prefer JWT" twice).
    back = [h["text"] for h in a["hypotheses"] + a["next_actions"] + a["stones"]
            if h["provenance"] != "stated" and similar(h["text"], STORY["dismissed_text"])]
    flowers = [m for m in a["mushrooms"] if m["status"] == "resolved"]
    pom = next((t for t in grove["trees"] if tid(28) in leaves(t)), None)
    print(f"\nre-grow {grove['run_id']} (degraded={grove['degraded']}):")
    print(f"  carved stones: {[(s['text'][:48], s['provenance']) for s in carved]}")
    print(f"  tab 13 is in {sponsor['name']!r} only: {sponsor is not None and leaves(sponsor) == [tid(13)]}; other trees holding it: {other13}")
    print(f"  dismissed hypothesis {STORY['dismissed_text'][:50]!r} came back: {bool(back)}")
    print(f"  resolved question stays a flower: {[(m['status'], m['answer'][:30]) for m in flowers]}")
    print(f"  tab 28 tree: {pom['name'] if pom else None!r}, goal {pom['goal']['provenance'] if pom else None} "
          f"{pom['goal']['text'][:40] if pom else None!r}")
    assert kept_stone, f"carved stone lost: {a['stones']}"
    assert sponsor is not None and leaves(sponsor) == [tid(13)] and not other13        # the pin held
    assert not back                                                                     # the dismissal held
    assert len(flowers) == 1 and flowers[0]["answer"].startswith("Keep the refresh token")   # the flower held, once
    assert pom is not None and pom["goal"]["provenance"] == "stated" and pom["goal"]["text"] == POMODORO
    assert c.get("/api/grove", headers=H).json()["run_id"] == grove["run_id"]
