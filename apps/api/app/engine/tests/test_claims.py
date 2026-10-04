"""R-10: confirm / edit / dismiss / resolve claims, assign tabs, clear the fog, analyze one project.

Real Tiger Cloud database, mocked Azure OpenAI (tests/test_grow.py's FakeClient): no network model calls.
Users …00e8 and …00e9 are test users; every row of both is deleted around each test.
"""

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from app.engine.tests import test_grow as tg  # FakeClient, demo_result, DEMO, SNAP
from app.engine import claims, db
from app.engine import grove as grove_mod
from app.engine.carry import similar
from app.engine.cluster import load_pins
from app.engine.grove import GrowRun
from app.engine.model_schema import ClusterInference
from app.engine.persist import last_grove, persist_run
from app.engine.problems import ProblemError
from app.engine.schemas import AssignResponse, ClaimDismissed, GroveResponse, Mushroom, NextAction, Stone
from app.engine.schemas.claims import AssignRequest, ClaimPatchRequest, NoteCreateRequest
from app.engine.settings import get_settings

pytestmark = pytest.mark.skipif(not get_settings().db_configured, reason="DATABASE_URL not set")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000e8")
OTHER = uuid.UUID("00000000-0000-4000-8000-0000000000e9")
TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches", "user_notes",
          "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings")
tid = tg.tid


def rich_auth(*, decisions=None, hypotheses=None, questions=True, actions=True, direction=True) -> ClusterInference:
    """The Backend Auth cluster as a model would answer it (refs follow opening order: t1=tab 1, t2=tab 3, t3=tab 4,
    t4=tab 5, t5=tab 6, t8=tab 7; q1 = the refresh-token search family)."""
    ev = lambda *refs: [{"ref": r, "why": "signal"} for r in refs]  # noqa: E731
    return ClusterInference.model_validate({
        "project_name": "Backend Auth",
        "goal": {"text": "Choose an authentication approach", "provenance": "inferred", "confidence": 0.8,
                 "evidence": ev("t1", "t2", "t3")},
        "branches": [{"branch_ref": "b1", "label": "JWT", "tab_refs": ["t1", "t3"], "status": "active"},
                     {"branch_ref": "b2", "label": "Sessions", "tab_refs": ["t2"], "status": "explored"}],
        "current_direction": {"text": "JWT is the preferred approach", "provenance": "inferred", "confidence": 0.8,
                              "evidence": ev("t3", "t2")} if direction else None,
        "decisions": decisions if decisions is not None else [
            {"text": "Use FastAPI's built-in OAuth2PasswordBearer", "provenance": "inferred", "user_note_ref": None,
             "quote": None, "confidence": 0.8, "evidence": ev("t1", "t3")},
            {"text": "Prefer HttpOnly cookies for refresh tokens", "provenance": "inferred", "user_note_ref": None,
             "quote": None, "confidence": 0.9, "evidence": ev("t8")}],           # one ref: downgraded to a hypothesis
        "unresolved_questions": [{"question": "Where should refresh tokens be stored?", "kind": "repeated_search",
                                  "provenance": "inferred", "confidence": 0.8, "evidence": ev("q1", "t5", "t8")}]
        if questions else [],
        "blockers": [],
        "next_actions": [{"action": "Prototype a refresh flow with HttpOnly cookies", "unblocks_question": 0,
                          "reason": "Most-searched open question", "provenance": "inferred", "confidence": 0.7,
                          "evidence": ev("t8", "t3")}] if actions else [],
        "redundant_groups": [], "important_tab_refs": ["t1", "t3"],
        "hypotheses": hypotheses if hypotheses is not None else [
            {"text": "May later host auth on Azure", "provenance": "hypothesis", "confidence": 0.4,
             "evidence": ev("t4")}]})


class Recording(tg.FakeClient):
    """FakeClient that keeps every prompt, so a test can read the DATA block the model was given."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.messages: list[list[dict[str, str]]] = []

    async def chat_structured_usage(self, messages, model):
        self.messages.append(messages)
        return await super().chat_structured_usage(messages, model)


@pytest.fixture
def world(monkeypatch):
    """A real DB with USER's first grow persisted. `world.grow()` re-grows (the existing project ids are reused)."""
    state = {"projects": {}}

    async def fake_cluster(*a, **k):
        result = tg.demo_result()
        for c, name in zip(result.clusters, tg.GROUPS, strict=True):
            c.is_existing_project_id = state["projects"].get(name)
        return result
    monkeypatch.setattr(grove_mod, "cluster_snapshot", fake_cluster)

    class World:
        pool = None
        loop = None

        async def grow(self, client=None, tabs=None):
            run = GrowRun(USER, tabs or tg.DEMO["open_tabs"], 3, pool=self.pool, client=client or self.client,
                          snapshot_at=tg.SNAP, persist=persist_run)
            lines = [line async for line in run.stream()]
            for name, tree in zip(tg.GROUPS, run.response["trees"], strict=True):
                state["projects"][name] = tree["project_id"][2:]
            return run, lines

        async def stored(self):
            return await last_grove(self.pool, USER)

        async def clean(self):
            for user in (USER, OTHER):
                for t in TABLES:
                    await self.pool.execute(f"DELETE FROM {t} WHERE user_id = $1", user)

        async def count(self):
            return sum([await self.pool.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = ANY($1::uuid[])", [USER, OTHER])
                        for t in TABLES])

    return World(), state


def scenario(world_state, test, *, client=None):
    """Run `test(w)` against a clean database with USER's first grow in place; always clean up, assert 0 left."""
    w, _ = world_state

    async def main():
        w.pool = await db.get_pool()
        w.client = client or Recording({"auth": lambda _: rich_auth()})
        await w.clean()
        try:
            await w.grow()
            return await test(w)
        finally:
            await w.clean()
            assert await w.count() == 0
            await db.close_pool()
    return asyncio.run(main())


def auth_tree(grove):
    return next(t for t in grove["trees"] if tid(1) in [l["tab_ref"] for b in t["branches"] for l in b["leaves"]])


def patch(pool, api_id, **body):
    return claims.patch_claim(pool, USER, api_id, ClaimPatchRequest.model_validate(body))


# --- claims: confirm / edit / dismiss / resolve ---------------------------------------------------------------

def test_confirm_a_mossy_stone_makes_it_stated_and_carved(world) -> None:
    async def test(w):
        tree = auth_tree(await w.stored())
        stone = next(s for s in tree["stones"] if s["kind"] == "mossy")
        assert stone["provenance"] == "inferred"
        out = await patch(w.pool, stone["id"], action="confirm")
        Stone.model_validate(out)
        assert (out["provenance"], out["confidence"], out["kind"], out["text"]) == ("stated", 1.0, "carved", stone["text"])
        assert out["display_text"] == out["text"] and out["user_note_id"].startswith("n_")
        assert out["evidence"][0] == {"ref_kind": "note", "ref": out["user_note_id"], "why": "user confirmed this decision"}
        assert out["evidence"][1:] == stone["evidence"]                      # the tab evidence stays (the contract)
        note = await w.pool.fetchrow("SELECT kind, text FROM user_notes WHERE user_id = $1 AND id = $2", USER,
                                     uuid.UUID(out["user_note_id"][2:]))
        assert (note["kind"], note["text"]) == ("decision", stone["text"])
        row = await w.pool.fetchrow("SELECT provenance, confidence, user_note_id, confirmed_at FROM decisions "
                                    "WHERE user_id = $1 AND id = $2", USER, uuid.UUID(stone["id"][4:]))
        assert row["provenance"] == "stated" and row["confidence"] == 1 and row["confirmed_at"] is not None
        now = auth_tree(await w.stored())
        assert next(s for s in now["stones"] if s["id"] == stone["id"])["kind"] == "carved"   # GET reflects it
        assert now["stones"][0]["id"] == stone["id"]                                          # carved stones first
        again = await patch(w.pool, stone["id"], action="confirm")                            # idempotent
        assert again["user_note_id"] == out["user_note_id"]
        assert await w.pool.fetchval("SELECT count(*) FROM user_notes WHERE user_id = $1", USER) == 1
    scenario(world, test)


def test_confirming_a_hypothesis_moves_it_to_its_slot(world) -> None:
    async def test(w):
        tree = auth_tree(await w.stored())
        hyp = next(h for h in tree["hypotheses"] if h["id"].startswith("dec_"))      # the downgraded decision
        assert hyp["provenance"] == "hypothesis" and hyp["confidence"] <= 0.59
        out = await patch(w.pool, hyp["id"], action="confirm")
        Stone.model_validate(out)
        assert out["kind"] == "carved" and out["provenance"] == "stated"
        now = auth_tree(await w.stored())
        assert hyp["id"] not in [h["id"] for h in now["hypotheses"]]
        assert now["stones"][0]["id"] == hyp["id"]
    scenario(world, test)


def test_edit_a_next_action_is_stated_with_a_note(world) -> None:
    async def test(w):
        action = auth_tree(await w.stored())["next_actions"][0]
        text = "Prototype a refresh flow with HttpOnly, Secure, SameSite=Strict cookies"
        out = await patch(w.pool, action["id"], action="edit", text=text)
        NextAction.model_validate(out)
        assert (out["text"], out["provenance"], out["confidence"], out["display_text"]) == (text, "stated", 1.0, text)
        assert out["unblocks"] == action["unblocks"] and out["reason"] == action["reason"]
        assert out["evidence"][0]["why"] == "user edited this action" and out["evidence"][0]["ref_kind"] == "note"
        row = await w.pool.fetchrow("SELECT action, provenance, user_note_id FROM suggested_actions WHERE user_id = $1 "
                                    "AND id = $2", USER, uuid.UUID(action["id"][2:]))
        assert (row["action"], row["provenance"]) == (text, "stated") and row["user_note_id"] is not None
        assert auth_tree(await w.stored())["next_actions"][0]["text"] == text
    scenario(world, test)


def test_dismiss_removes_the_claim_and_is_idempotent(world) -> None:
    async def test(w):
        tree = auth_tree(await w.stored())
        hyp = next(h for h in tree["hypotheses"] if h["id"].startswith("h_"))
        out = await patch(w.pool, hyp["id"], action="dismiss")
        ClaimDismissed.model_validate(out)
        assert out["id"] == hyp["id"] and out["status"] == "dismissed"
        assert hyp["id"] not in [h["id"] for h in auth_tree(await w.stored())["hypotheses"]]
        assert await w.pool.fetchval("SELECT dismissed_at FROM decisions WHERE user_id = $1 AND id = $2", USER,
                                     uuid.UUID(hyp["id"][2:])) is not None
        again = await patch(w.pool, hyp["id"], action="dismiss")
        assert again["dismissed_at"] == out["dismissed_at"]
        for kind, slot in (("a_", "next_actions"), ("q_", "mushrooms"), ("dir_", "direction")):  # every kind of claim
            tree = auth_tree(await w.stored())
            claim = tree[slot] if slot == "direction" else tree[slot][0]
            assert claim["id"].startswith(kind)
            await patch(w.pool, claim["id"], action="dismiss")
        now = auth_tree(await w.stored())
        assert now["next_actions"] == [] and now["mushrooms"] == [] and now["direction"] is None
        action = await w.pool.fetchval("SELECT status FROM suggested_actions WHERE user_id = $1 AND status = 'dismissed'", USER)
        assert action == "dismissed"
        with pytest.raises(ProblemError) as err:
            await patch(w.pool, now["goal"]["id"], action="dismiss")
        assert err.value.status_code == 422
    scenario(world, test)


def test_resolve_a_question_turns_the_mushroom_into_a_flower(world) -> None:
    async def test(w):
        q = auth_tree(await w.stored())["mushrooms"][0]
        assert q["status"] == "open" and q["kind"] == "repeated_search" and q["recurrence"] == 4
        answer = "Keep the refresh token in an HttpOnly, Secure, SameSite=Strict cookie"
        out = await patch(w.pool, q["id"], action="resolve", answer=answer)
        Mushroom.model_validate(out)
        assert (out["status"], out["answer"]) == ("resolved", answer) and out["resolved_at"].endswith("Z")
        assert out["text"] == q["text"] and out["provenance"] == q["provenance"] and out["recurrence"] == 4
        row = await w.pool.fetchrow("SELECT status, answer, resolved_at FROM unresolved_questions WHERE user_id = $1 "
                                    "AND id = $2", USER, uuid.UUID(q["id"][2:]))
        assert (row["status"], row["answer"]) == ("resolved", answer) and row["resolved_at"] is not None
        assert auth_tree(await w.stored())["mushrooms"][0]["status"] == "resolved"
        with pytest.raises(ProblemError) as err:                                       # only questions resolve
            await patch(w.pool, auth_tree(await w.stored())["next_actions"][0]["id"], action="resolve", answer="x")
        assert err.value.status_code == 422
    scenario(world, test)


def test_edit_and_confirm_the_goal(world) -> None:
    async def test(w):
        goal = auth_tree(await w.stored())["goal"]
        out = await patch(w.pool, goal["id"], action="edit", text="Pick an auth architecture for v1")
        assert (out["provenance"], out["text"]) == ("stated", "Pick an auth architecture for v1")
        tree = auth_tree(await w.stored())
        assert tree["goal"]["id"] == goal["id"] and tree["goal"]["provenance"] == "stated" and not tree["fogged"]
        note = await w.pool.fetchrow("SELECT kind FROM user_notes WHERE user_id = $1", USER)
        assert note["kind"] == "goal"
    scenario(world, test)


# --- the next grow keeps what the user did -------------------------------------------------------------------------

def test_regrow_keeps_carved_dismissed_and_resolved(world) -> None:
    async def test(w):
        tree = auth_tree(await w.stored())
        stone = next(s for s in tree["stones"] if s["kind"] == "mossy")
        hyp = next(h for h in tree["hypotheses"] if h["id"].startswith("h_"))
        question = tree["mushrooms"][0]
        await patch(w.pool, stone["id"], action="confirm")
        await patch(w.pool, hyp["id"], action="dismiss")
        await patch(w.pool, question["id"], action="resolve", answer="HttpOnly cookie")
        # The model now forgets the decision, repeats the dismissed hypothesis in other words, and re-asks the question.
        again = rich_auth(decisions=[], hypotheses=[
            {"text": "Might host the auth service on Azure later", "provenance": "hypothesis", "confidence": 0.4,
             "evidence": [{"ref": "t4", "why": "signal"}]}])
        w.client = Recording({"auth": lambda _: again})
        run, _ = await w.grow()
        now = auth_tree(run.response)
        assert [s["text"] for s in now["stones"] if s["kind"] == "carved"] == [stone["text"]]    # carved stays
        assert not any("azure" in h["text"].lower() for h in now["hypotheses"])                   # dismissed stays gone
        flower = now["mushrooms"][0]
        assert (flower["status"], flower["answer"]) == ("resolved", "HttpOnly cookie")           # flower stays
        assert flower["resolved_at"] and flower["text"] == question["text"]
        dismissed = next(tg.payload_of(m) for m in w.client.messages[-6:] if "dismissed_by_user" in tg.payload_of(m))
        assert any("azure" in d.lower() for d in dismissed["dismissed_by_user"])                 # the model was told
        assert (await w.stored())["run_id"] == run.response["run_id"]
        # A second re-grow, and a model that asks the open loop twice: still ONE flower (each resolved
        # question comes back once, however many copies earlier grows stored).
        twice = rich_auth(decisions=[], hypotheses=[])
        twice.unresolved_questions.append(twice.unresolved_questions[0].model_copy(
            update={"question": "Is an HttpOnly cookie or localStorage the right place for refresh tokens?"}))
        w.client = Recording({"auth": lambda _: twice})
        run, _ = await w.grow()
        run, _ = await w.grow()
        flowers = [m for m in auth_tree(run.response)["mushrooms"] if m["status"] == "resolved"]
        assert len(flowers) == 1 and flowers[0]["answer"] == "HttpOnly cookie"
        assert len([m for m in auth_tree(run.response)["mushrooms"] if m["status"] == "open"]) == 1
    scenario(world, test)


def test_a_seedling_run_does_not_rename_existing_projects(world) -> None:
    class Down(tg.FakeClient):
        async def chat_structured_usage(self, messages, model):
            raise RuntimeError("401")

    async def test(w):
        names = lambda: w.pool.fetch("SELECT id, name FROM projects WHERE user_id = $1 ORDER BY name", USER)  # noqa: E731
        before = await names()
        run, _ = await w.grow(client=Down())
        assert run.response["degraded"] and all(t["name"].endswith(" terms") for t in run.response["trees"])
        assert [dict(r) for r in await names()] == [dict(r) for r in before]           # DB names are the model's, still
        assert all(not r["name"].endswith(" terms") for r in before)
    scenario(world, test)


def test_goal_note_and_user_named_project_survive_a_regrow(world) -> None:
    async def test(w):
        goal = auth_tree(await w.stored())["goal"]
        await patch(w.pool, goal["id"], action="edit", text="Pick an auth architecture for v1")
        run, _ = await w.grow()
        tree = auth_tree(run.response)
        assert tree["goal"]["text"] == "Pick an auth architecture for v1" and tree["goal"]["provenance"] == "stated"
        assert not tree["fogged"] and tree["goal"]["evidence"][0]["why"] == "user named this goal"
    scenario(world, test)


def test_similar_text_rule() -> None:
    assert similar("Maybe: prefer JWT over session-based authentication for REST API",
                   "preferring JWT over session-based authentication for a REST API")
    assert similar("May later host auth on Azure", "Might host the auth service on Azure later")
    assert not similar("May later host auth on Azure", "Use HttpOnly cookies for refresh tokens")
    assert not similar("", "anything") and not similar("a b", "c d")


# --- assign ---------------------------------------------------------------------------------------------------------

def test_assign_to_an_existing_tree_and_branch_is_pinned(world) -> None:
    async def test(w):
        grove = await w.stored()
        girl = next(t for t in grove["trees"] if t["name"] == "Girlhacks")
        out, status = await claims.assign_tab(w.pool, USER, tid(13), AssignRequest(
            project_id=auth_tree(grove)["project_id"], branch_label="Sessions"))
        AssignResponse.model_validate(out)
        assert status == 200 and out["from_project_id"] == girl["project_id"]
        assert (out["project_id"], out["branch_label"], out["pinned"]) == (auth_tree(grove)["project_id"], "Sessions", True)
        assert out["reanalyze_project_ids"] == [girl["project_id"], auth_tree(grove)["project_id"]]
        row = await w.pool.fetchrow("SELECT assigned_by FROM cluster_tabs WHERE user_id = $1 AND tab_ref = $2 "
                                    "ORDER BY assigned_at DESC LIMIT 1", USER, uuid.UUID(tid(13)))
        assert row["assigned_by"] == "user"
        assert await load_pins(w.pool, USER, [tid(13)]) == {tid(13): auth_tree(grove)["project_id"][2:]}
        now = await w.stored()
        sessions = next(b for b in auth_tree(now)["branches"] if b["label"] == "Sessions")
        assert tid(13) in [l["tab_ref"] for l in sessions["leaves"]]
        assert tid(13) not in [l["tab_ref"] for b in next(t for t in now["trees"] if t["name"] == "Girlhacks")["branches"]
                               for l in b["leaves"]]
    scenario(world, test)


def test_assign_to_a_new_tree_names_it_and_keeps_the_name(world) -> None:
    async def test(w):
        out, status = await claims.assign_tab(w.pool, USER, tid(13), AssignRequest(new_project_name="Hackathon sponsor docs"))
        AssignResponse.model_validate(out)
        assert status == 201 and out["branch_label"] is None and out["project_name"] == "Hackathon sponsor docs"
        now = await w.stored()
        new = next(t for t in now["trees"] if t["name"] == "Hackathon sponsor docs")
        assert [l["tab_ref"] for b in new["branches"] for l in b["leaves"]] == [tid(13)]
        assert new["project_id"] == out["project_id"] and new["goal"]["provenance"] == "hypothesis"
        assert await load_pins(w.pool, USER, [tid(13)]) == {tid(13): out["project_id"][2:]}
        # Re-grow with that project present: its name is the user's, and the DB keeps it too.
        result = tg.demo_result()
        result.clusters[1].is_existing_project_id = out["project_id"][2:]
        grove_mod.cluster_snapshot = lambda *a, **k: _async(result)
        run, _ = await w.grow()
        assert await w.pool.fetchval("SELECT name FROM projects WHERE user_id = $1 AND id = $2", USER,
                                     uuid.UUID(out["project_id"][2:])) == "Hackathon sponsor docs"
        assert next(t for t in run.response["trees"] if t["project_id"] == out["project_id"])["name"] == \
            "Hackathon sponsor docs"
    scenario(world, test)


async def _async(value):
    return value


def test_assign_unknown_tab_or_project_is_404(world) -> None:
    async def test(w):
        grove = await w.stored()
        for tab, body in ((tid(99), AssignRequest(new_project_name="x")),
                          (tid(13), AssignRequest(project_id=f"p_{uuid.uuid4()}")),
                          ("not-a-uuid", AssignRequest(new_project_name="x"))):
            with pytest.raises(ProblemError) as err:
                await claims.assign_tab(w.pool, USER, tab, body)
            assert err.value.status_code == 404
        with pytest.raises(ProblemError) as err:                         # someone else's tab and project
            await claims.assign_tab(w.pool, OTHER, tid(13), AssignRequest(project_id=auth_tree(grove)["project_id"]))
        assert err.value.status_code == 404
    scenario(world, test)


# --- notes: clear the fog ---------------------------------------------------------------------------------------------

def test_clear_the_fog_gives_a_loose_tab_its_own_stated_tree(world) -> None:
    async def test(w):
        before = await w.stored()
        assert any(f["tab_ref"] == tid(28) for f in before["fog"])
        text = "Use a Pomodoro timer for focused work blocks"
        out = await claims.create_note(w.pool, USER, NoteCreateRequest(kind="goal", tab_ref=tid(28), text=text))
        assert out["note"]["kind"] == "goal" and out["note"]["tab_ref"] == tid(28) and out["note"]["text"] == text
        assert out["claim"]["provenance"] == "stated" and out["claim"]["display_text"] == text
        assert [e["ref_kind"] for e in out["claim"]["evidence"]] == ["note", "tab"]
        now = await w.stored()
        assert not any(f["tab_ref"] == tid(28) for f in now["fog"])
        tree = next(t for t in now["trees"] if t["project_id"] == out["project_id"])
        assert tree["goal"]["text"] == text and tree["goal"]["provenance"] == "stated" and not tree["fogged"]
        assert [l["tab_ref"] for b in tree["branches"] for l in b["leaves"]] == [tid(28)]
        assert await load_pins(w.pool, USER, [tid(28)]) == {tid(28): out["project_id"][2:]}
        goal = await patch(w.pool, tree["goal"]["id"], action="confirm")          # its goal id resolves
        assert goal["provenance"] == "stated"
        GroveResponse.model_validate(now)
    scenario(world, test)


def test_notes_for_a_tree_name_its_goal_or_record_a_decision(world) -> None:
    async def test(w):
        tree = auth_tree(await w.stored())
        out = await claims.create_note(w.pool, USER, NoteCreateRequest(kind="decision", project_id=tree["project_id"],
                                                                       text="No third-party auth libraries"))
        assert out["claim"]["id"].startswith("dec_") and out["project_id"] == tree["project_id"]
        now = auth_tree(await w.stored())
        assert now["stones"][0]["text"] == "No third-party auth libraries" and now["stones"][0]["kind"] == "carved"
        fog_tab = next(t for t in (await w.stored())["trees"] if t["name"] == "Dinner")["branches"][0]["leaves"][0]["tab_ref"]
        named = await claims.create_note(w.pool, USER, NoteCreateRequest(kind="goal", tab_ref=fog_tab,
                                                                         text="Cook dinner in 30 minutes"))
        dinner = next(t for t in (await w.stored())["trees"] if t["project_id"] == named["project_id"])
        assert dinner["name"] == "Dinner" and dinner["goal"]["text"] == "Cook dinner in 30 minutes"   # the tab's own tree
        plain = await claims.create_note(w.pool, USER, NoteCreateRequest(kind="note", project_id=tree["project_id"],
                                                                         text="Ask the team about SSO"))
        assert plain["claim"]["id"] == plain["note"]["id"] and plain["claim"]["provenance"] == "stated"
        with pytest.raises(ProblemError) as err:                              # a loose tab needs a goal, not a decision
            await claims.create_note(w.pool, USER, NoteCreateRequest(kind="decision", tab_ref=tid(28), text="x"))
        assert err.value.status_code == 422
        for body in (NoteCreateRequest(kind="goal", tab_ref=tid(99), text="x"),
                     NoteCreateRequest(kind="note", project_id=f"p_{uuid.uuid4()}", text="x")):
            with pytest.raises(ProblemError) as err:
                await claims.create_note(w.pool, USER, body)
            assert err.value.status_code == 404
    scenario(world, test)


# --- analyze --------------------------------------------------------------------------------------------------------------

def test_analyze_one_project_honours_notes_and_dismissals(world) -> None:
    async def test(w):
        tree = auth_tree(await w.stored())
        hyp = next(h for h in tree["hypotheses"] if h["id"].startswith("h_"))
        await patch(w.pool, hyp["id"], action="dismiss")
        await claims.create_note(w.pool, USER, NoteCreateRequest(kind="decision", project_id=tree["project_id"],
                                                                 text="No third-party auth libraries"))
        w.client = Recording({"auth": lambda _: rich_auth(hypotheses=[
            {"text": "Might host the auth service on Azure later", "provenance": "hypothesis", "confidence": 0.4,
             "evidence": [{"ref": "t4", "why": "signal"}]}])})
        out = await claims.analyze_project(w.pool, w.client, USER, tree["project_id"])
        assert out["project_id"] == tree["project_id"]
        assert [s["text"] for s in out["stones"] if s["kind"] == "carved"] == ["No third-party auth libraries"]
        assert not any("azure" in h["text"].lower() for h in out["hypotheses"])
        stored = auth_tree(await w.stored())
        assert stored["goal"]["id"] == out["goal"]["id"]                       # GET reflects the new tree
        assert len(w.client.messages) == 1                                      # exactly one model call
        runs = await w.pool.fetch("SELECT kind, llm_calls, tokens FROM analysis_runs WHERE user_id = $1 ORDER BY ts", USER)
        assert [r["kind"] for r in runs] == ["grow", "analyze_project"] and runs[1]["llm_calls"] == 1
        for bad in (f"p_{uuid.uuid4()}", "p_nope", tree["project_id"][2:]):
            with pytest.raises(ProblemError) as err:
                await claims.analyze_project(w.pool, w.client, USER, bad)
            assert err.value.status_code == 404
        with pytest.raises(ProblemError) as err:                                # another user's project
            await claims.analyze_project(w.pool, w.client, OTHER, tree["project_id"])
        assert err.value.status_code == 404
    scenario(world, test)


def test_analyze_leaves_the_tree_alone_when_the_model_is_down(world) -> None:
    async def test(w):
        tree = auth_tree(await w.stored())

        class Down(tg.FakeClient):
            async def chat_structured_usage(self, messages, model):
                raise RuntimeError("down")
        with pytest.raises(ProblemError) as err:
            await claims.analyze_project(w.pool, Down(), USER, tree["project_id"])
        assert err.value.status_code == 503 and err.value.headers == {"Retry-After": "30"}
        assert auth_tree(await w.stored()) == tree                              # unchanged
        assert await w.pool.fetchval("SELECT count(*) FROM analysis_runs WHERE user_id = $1 AND kind = 'analyze_project'",
                                     USER) == 0
    scenario(world, test)


# --- HTTP: 404 across users, 422 for user_id, contract shapes ----------------------------------------------------------

def test_http_cross_user_404_and_user_id_422(world) -> None:
    w, _ = world
    ids: dict[str, str] = {}

    async def setup(w):
        grove = await w.stored()
        tree = auth_tree(grove)
        ids.update(stone=tree["stones"][0]["id"], action=tree["next_actions"][0]["id"], q=tree["mushrooms"][0]["id"],
                   goal=tree["goal"]["id"], hyp=next(h["id"] for h in tree["hypotheses"] if h["id"].startswith("h_")),
                   project=tree["project_id"])
        return True

    async def main():
        w.pool = await db.get_pool()
        w.client = Recording({"auth": lambda _: rich_auth()})
        await w.clean()
        try:
            await w.grow()
            await setup(w)
        finally:
            await db.close_pool()
    asyncio.run(main())
    from app.engine.standalone import app
    mine, other = {"X-Dev-User": str(USER)}, {"X-Dev-User": str(OTHER)}
    try:
        with TestClient(app) as c:
            for key in ("stone", "action", "q", "goal", "hyp"):                        # another user's ids: 404 problem
                r = c.patch(f"/api/claims/{ids[key]}", json={"action": "confirm"}, headers=other)
                assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem+json"), key
                assert r.json()["detail"] == "Claim not found"
            assert c.patch("/api/claims/dec_e0000000-0000-4000-8000-000000000404", json={"action": "confirm"},
                           headers=mine).status_code == 404
            assert c.patch("/api/claims/garbage", json={"action": "confirm"}, headers=mine).status_code == 404
            assert c.post(f"/api/tabs/{tid(13)}/assign", json={"project_id": ids["project"]}, headers=other).status_code == 404
            assert c.post("/api/notes", json={"kind": "goal", "tab_ref": tid(28), "text": "x"}, headers=other).status_code == 404
            assert c.post(f"/api/projects/{ids['project']}/analyze", headers=other).status_code == 404
            for method, path, body in (("patch", f"/api/claims/{ids['stone']}", {"action": "confirm"}),
                                       ("post", f"/api/tabs/{tid(13)}/assign", {"new_project_name": "x"}),
                                       ("post", "/api/notes", {"kind": "goal", "tab_ref": tid(28), "text": "x"})):
                r = getattr(c, method)(path, json={**body, "user_id": str(OTHER)}, headers=mine)
                assert r.status_code == 422 and r.headers["content-type"].startswith("application/problem+json")
                assert r.json()["detail"] == "Request body contains fields that are not allowed"
                assert r.json()["errors"][0]["loc"] == ["body", "user_id"] and r.json()["instance"] == path
            assert c.patch(f"/api/claims/{ids['stone']}", json={"action": "edit"}, headers=mine).status_code == 422
            assert c.patch(f"/api/claims/{ids['stone']}", json={"action": "confirm"}).status_code == 401
            ok = c.patch(f"/api/claims/{ids['stone']}", json={"action": "confirm"}, headers=mine)
            assert ok.status_code == 200 and ok.json()["provenance"] == "stated"
            gone = c.patch(f"/api/claims/{ids['hyp']}", json={"action": "dismiss"}, headers=mine)
            assert gone.status_code == 200 and set(gone.json()) == {"id", "status", "dismissed_at"}
            assign = c.post(f"/api/tabs/{tid(13)}/assign", json={"new_project_name": "Hackathon sponsor docs"}, headers=mine)
            assert assign.status_code == 201 and assign.json()["assigned_by"] == "user"
            assert c.get("/api/grove", headers=mine).json()["trees"][-1]["name"] == "Hackathon sponsor docs"
    finally:
        async def clean():
            pool = await db.get_pool()
            try:
                for user in (USER, OTHER):
                    for t in TABLES:
                        await pool.execute(f"DELETE FROM {t} WHERE user_id = $1", user)
                assert sum([await pool.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = ANY($1::uuid[])", [USER, OTHER])
                            for t in TABLES]) == 0
            finally:
                await db.close_pool()
        asyncio.run(clean())
