"""R-10: the user's actions on the grove (proposal §5, §17, §24, §27, contracts/claims.example.json).

PATCH /api/claims/{id}          confirm | edit | dismiss | resolve
POST  /api/tabs/{tab_ref}/assign  move a tab to another tree (pinned), or to a new one
POST  /api/notes                "Clear the fog": name a goal, record a decision or a note
POST  /api/projects/{id}/analyze  re-run inference for one project

Every function runs in ONE transaction that also updates the stored grove (analysis_runs.response)
so GET /api/grove reflects the change at once. user_id comes from the token and stamps or filters
every statement; an id that is not the user's is a 404.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from . import grove_edit as ge
from .adapters.stats import StatsSource, get_stats_source
from .cluster import Cluster, load_pins
from .embeddings import embed_tabs
from .features import visits_from
from .grove import GrowRun
from .infer import infer_cluster
from .labels import top_terms
from .normalize import leaf_source_type, normalize_tab
from .persist import budget_exceeded, last_grove_row, persist_build, usage_today
from .problems import ProblemError
from .schemas.claims import AssignRequest, ClaimPatchRequest, NoteCreateRequest
from .schemas.common import Claim
from .schemas.grove import Mushroom, NextAction, Stone, Tree
from .validate import display_text

log = logging.getLogger("tabforest.engine.claims")

PREFIXES = ("dec_", "dir_", "h_", "q_", "a_", "g_")
KIND_OF_PREFIX = {"dec_": "decision", "dir_": "direction", "h_": "hypothesis", "q_": "question", "a_": "action",
                  "g_": "goal"}
NOTE_KIND_OF_PREFIX = {"dec_": "decision", "dir_": "decision", "h_": "decision", "g_": "goal", "q_": "note",
                       "a_": "note"}
NEW_TREE_GOAL_CONFIDENCE = 0.45
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def not_found(what: str) -> ProblemError:
    return ProblemError(404, "Not Found", f"{what} not found")


def need_db(pool: Any) -> None:
    if pool is None:
        raise ProblemError(503, "Service Unavailable", "Memory is not configured", headers={"Retry-After": "30"})


def split_id(api_id: str, prefixes: tuple[str, ...]) -> tuple[str, UUID] | None:
    for prefix in sorted(prefixes, key=len, reverse=True):
        if api_id.startswith(prefix) and _UUID.match(api_id[len(prefix):].lower()):
            return prefix, UUID(api_id[len(prefix):])
    return None


def _j(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _load(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------------------
# Claims
# ---------------------------------------------------------------------------------------

class ClaimRow:
    """A claim as stored (decisions, unresolved_questions, suggested_actions, or a cluster's goal)."""

    def __init__(self, prefix: str, uid: UUID, row: Any) -> None:
        self.prefix, self.uid, self.api_id = prefix, uid, prefix + str(uid)
        self.cluster_id: UUID = row["cluster_id"]
        self.project_id: UUID = row["project_id"]
        self.text: str = row["text"]
        self.provenance: str = row["provenance"]
        self.confidence: float = row["confidence"]
        self.evidence: list[dict[str, str]] = _load(row["evidence"]) or []
        note = row["user_note_id"]
        self.user_note_id: str | None = f"n_{note}" if note else None
        self.dismissed = bool(row["dismissed"])
        self.dismissed_at: datetime | None = row["dismissed_at"]
        self.extra = {k: row[k] for k in row.keys() if k not in (
            "cluster_id", "project_id", "text", "provenance", "confidence", "evidence", "user_note_id", "dismissed",
            "dismissed_at")}


async def load_claim(conn: Any, user_id: UUID, prefix: str, uid: UUID) -> ClaimRow | None:
    if prefix == "g_":
        sql = ("SELECT ic.id AS cluster_id, ic.project_id, ic.goal AS text, ic.goal_provenance AS provenance, "
               "ic.goal_confidence AS confidence, ic.goal_evidence AS evidence, ic.goal_user_note_id AS user_note_id, "
               "false AS dismissed, NULL::timestamptz AS dismissed_at "
               "FROM intent_clusters ic WHERE ic.user_id = $1 AND ic.goal_id = $2")
    elif prefix in ("dec_", "dir_", "h_"):
        sql = ("SELECT d.cluster_id, ic.project_id, d.text, d.provenance, d.confidence, d.evidence, d.user_note_id, "
               "d.dismissed_at IS NOT NULL AS dismissed, d.dismissed_at, d.quote "
               "FROM decisions d JOIN intent_clusters ic ON ic.id = d.cluster_id AND ic.user_id = d.user_id "
               "WHERE d.user_id = $1 AND d.id = $2")
    elif prefix == "q_":
        sql = ("SELECT q.cluster_id, ic.project_id, q.question AS text, q.provenance, q.confidence, q.evidence, "
               "q.user_note_id, q.dismissed_at IS NOT NULL AS dismissed, q.dismissed_at, q.kind, q.recurrence, "
               "q.status, q.answer, q.resolved_at "
               "FROM unresolved_questions q JOIN intent_clusters ic ON ic.id = q.cluster_id AND ic.user_id = q.user_id "
               "WHERE q.user_id = $1 AND q.id = $2")
    else:
        sql = ("SELECT a.cluster_id, ic.project_id, a.action AS text, a.provenance, a.confidence, a.evidence, "
               "a.user_note_id, a.status = 'dismissed' AS dismissed, NULL::timestamptz AS dismissed_at, a.reason, "
               "a.unblocks_question_id "
               "FROM suggested_actions a JOIN intent_clusters ic ON ic.id = a.cluster_id AND ic.user_id = a.user_id "
               "WHERE a.user_id = $1 AND a.id = $2")
    row = await conn.fetchrow(sql, user_id, uid)
    return ClaimRow(prefix, uid, row) if row else None


def claim_api(c: ClaimRow, home: str) -> dict[str, Any]:
    """The claim in its grove shape (Claim, Stone, Mushroom or NextAction) for the slot it lives in."""
    out = {"id": c.api_id, "text": c.text, "provenance": c.provenance, "confidence": c.confidence,
           "display_text": display_text(KIND_OF_PREFIX[c.prefix], c.provenance, c.text), "evidence": c.evidence,
           "user_note_id": c.user_note_id}
    if home == "stones":
        out.update(kind="carved" if c.provenance in ("stated", "sourced") else "mossy", quote=c.extra.get("quote"))
    elif home == "mushrooms":
        resolved = c.extra.get("resolved_at")
        out.update(kind=c.extra.get("kind") or "repeated_search", status=c.extra.get("status") or "open",
                   answer=c.extra.get("answer"), resolved_at=_iso(resolved) if resolved else None,
                   recurrence=c.extra.get("recurrence") or 1)
    elif home == "next_actions":
        unblocks = c.extra.get("unblocks_question_id")
        out.update(unblocks=f"q_{unblocks}" if unblocks else None, reason=c.extra.get("reason") or "")
    return out


def home_slot(c: ClaimRow, tree: dict[str, Any] | None) -> str:
    """Where a confirmed or edited claim lives: its own slot; a hypothesis moves to the slot of its kind."""
    if c.prefix == "g_":
        return "goal"
    if c.prefix == "q_":
        return "mushrooms"
    if c.prefix == "a_":
        return "next_actions"
    if c.prefix == "dir_":
        free = tree is None or tree.get("direction") is None or tree["direction"]["id"] == c.api_id
        return "direction" if free else "stones"
    return "stones"  # dec_ and h_


MODEL = {"goal": Claim, "direction": Claim, "stones": Stone, "mushrooms": Mushroom, "next_actions": NextAction}


async def _insert_note(conn: Any, user_id: UUID, project_id: UUID, cluster_id: UUID | None, kind: str, text: str,
                       tab_ref: UUID | None = None) -> tuple[UUID, datetime]:
    row = await conn.fetchrow(
        "INSERT INTO user_notes (user_id, project_id, cluster_id, tab_ref, kind, text) "
        "VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at", user_id, project_id, cluster_id, tab_ref, kind, text)
    return row["id"], row["created_at"]


async def patch_claim(pool: Any, user_id: UUID, api_id: str, body: ClaimPatchRequest) -> dict[str, Any]:
    need_db(pool)
    parsed = split_id(api_id, PREFIXES)
    if parsed is None:
        raise not_found("Claim")
    prefix, uid = parsed
    async with pool.acquire() as conn, conn.transaction():
        grove_row = await last_grove_row(conn, user_id, lock=True)  # serializes the user's mutations
        c = await load_claim(conn, user_id, prefix, uid)
        if c is None:
            raise not_found("Claim")
        grove = grove_row["response"] if grove_row else None
        where = ge.find_claim(grove, api_id) if grove else None
        tree = where[0] if where else None
        changed = False

        if body.action == "dismiss":
            if prefix == "g_":
                raise ProblemError(422, "Unprocessable Entity",
                                   "A goal cannot be dismissed; edit it or name it with POST /api/notes")
            at = c.dismissed_at or _now()
            if prefix == "a_":
                await conn.execute("UPDATE suggested_actions SET status = 'dismissed' WHERE user_id = $1 AND id = $2",
                                   user_id, uid)
            else:
                table = "decisions" if prefix in ("dec_", "dir_", "h_") else "unresolved_questions"
                await conn.execute(f"UPDATE {table} SET dismissed_at = coalesce(dismissed_at, $3) "
                                   f"WHERE user_id = $1 AND id = $2", user_id, uid, at)
            if c.user_note_id:  # the note that made it stated goes with it, or the next grow would restore it
                await conn.execute("DELETE FROM user_notes WHERE user_id = $1 AND id = $2", user_id,
                                   UUID(c.user_note_id[2:]))
            if where:
                ge.remove_claim(tree, where[1], where[2])
                changed = True
            result = {"id": api_id, "status": "dismissed", "dismissed_at": _iso(at)}

        elif body.action == "resolve":
            if prefix != "q_":
                raise ProblemError(422, "Unprocessable Entity", "Only an open question can be resolved")
            at = _now()
            await conn.execute("UPDATE unresolved_questions SET status = 'resolved', answer = $3, resolved_at = $4 "
                               "WHERE user_id = $1 AND id = $2", user_id, uid, body.answer, at)
            c.extra.update(status="resolved", answer=body.answer, resolved_at=at)
            result = claim_api(c, "mushrooms")
            Mushroom.model_validate(result)
            if where:
                ge.place_claim(tree, (where[1], where[2]), "mushrooms", result)
                changed = True

        else:  # confirm | edit -> stated, with a note of the user's
            text = body.text if body.action == "edit" else c.text
            if body.action == "confirm" and c.provenance == "stated":  # already the user's: nothing to add
                home = home_slot(c, tree)
                result = claim_api(c, home)
                MODEL[home].model_validate(result)
            else:
                noun = KIND_OF_PREFIX[prefix]
                note_id, _ = await _insert_note(conn, user_id, c.project_id, c.cluster_id, NOTE_KIND_OF_PREFIX[prefix],
                                                text)
                api_note = f"n_{note_id}"
                why = f"user {'confirmed' if body.action == 'confirm' else 'edited'} this {noun}"
                evidence = [{"ref_kind": "note", "ref": api_note, "why": why},
                            *[e for e in c.evidence if not (e["ref_kind"] == "note" and e["ref"] == api_note)]]
                await _store_stated(conn, user_id, c, uid, text, note_id, evidence)
                c.text, c.provenance, c.confidence, c.evidence, c.user_note_id = text, "stated", 1.0, evidence, api_note
                home = home_slot(c, tree)
                result = claim_api(c, home)
                MODEL[home].model_validate(result)
                if where:
                    ge.place_claim(tree, (where[1], where[2]), home, result)
                    if prefix == "g_":
                        tree["fogged"] = False
                    changed = True

        if changed:
            await conn.execute("UPDATE analysis_runs SET response = $3::jsonb WHERE user_id = $1 AND run_id = $2",
                               user_id, grove_row["run_id"], _j(grove))
    return result


async def _store_stated(conn: Any, user_id: UUID, c: ClaimRow, uid: UUID, text: str, note_id: UUID,
                        evidence: list[dict[str, str]]) -> None:
    if c.prefix == "g_":
        await conn.execute(
            "UPDATE intent_clusters SET goal = $3, goal_provenance = 'stated', goal_confidence = 1, "
            "goal_evidence = $4::jsonb, goal_user_note_id = $5, fogged = false WHERE user_id = $1 AND goal_id = $2",
            user_id, uid, text, _j(evidence), note_id)
    elif c.prefix in ("dec_", "dir_", "h_"):
        await conn.execute(
            "UPDATE decisions SET text = $3, provenance = 'stated', confidence = 1, evidence = $4::jsonb, "
            "user_note_id = $5, quote = NULL, confirmed_at = now() WHERE user_id = $1 AND id = $2",
            user_id, uid, text, _j(evidence), note_id)
    elif c.prefix == "q_":
        await conn.execute(
            "UPDATE unresolved_questions SET question = $3, provenance = 'stated', confidence = 1, "
            "evidence = $4::jsonb, user_note_id = $5, quote = NULL WHERE user_id = $1 AND id = $2",
            user_id, uid, text, _j(evidence), note_id)
    else:
        await conn.execute(
            "UPDATE suggested_actions SET action = $3, provenance = 'stated', confidence = 1, evidence = $4::jsonb, "
            "user_note_id = $5, quote = NULL WHERE user_id = $1 AND id = $2",
            user_id, uid, text, _j(evidence), note_id)


# ---------------------------------------------------------------------------------------
# Assign and "clear the fog"
# ---------------------------------------------------------------------------------------

async def _tab_facts(conn: Any, user_id: UUID, tab_ref: str, grove: dict[str, Any] | None,
                     snapshot: dict[str, Any] | None, stats: StatsSource) -> dict[str, Any] | None:
    """Where the tab is now, and what a leaf for it needs. None if the user has no such tab."""
    leaf_hit = ge.find_leaf(grove, tab_ref) if grove else None
    in_grove = bool(grove) and ge.tab_in_grove(grove, tab_ref)
    latest = await conn.fetchrow(
        "SELECT ct.cluster_id, ic.project_id, ct.importance FROM cluster_tabs ct "
        "JOIN intent_clusters ic ON ic.id = ct.cluster_id AND ic.user_id = ct.user_id "
        "WHERE ct.user_id = $1 AND ct.tab_ref = $2 ORDER BY ct.assigned_at DESC LIMIT 1", user_id, UUID(tab_ref))
    if not in_grove and latest is None:
        return None
    if leaf_hit:
        leaf = dict(leaf_hit[2])
    else:  # a meadow, fog or sprout tab: build its leaf from the stored snapshot
        tab = next((t for t in (snapshot or {}).get("open_tabs", []) if t["tab_ref"] == tab_ref), None)
        ms = sum(v.active_ms for v in visits_from(await stats.events(user_id, {tab_ref})) if v.tab_ref == tab_ref)
        title, domain = (tab["title"], tab["domain"]) if tab else ("Tab", "unknown")
        kind = leaf_source_type(normalize_tab({"tab_ref": tab_ref, "domain": domain, "title": title}).source_type)
        leaf = {"tab_ref": tab_ref, "title": title, "domain": domain, "source_type": kind.value,
                "dwell_min": round(ms / 60000, 1), "is_open": True, "importance": 0.0, "fallen": False}
    from_project = (leaf_hit[0]["project_id"][2:] if leaf_hit else (str(latest["project_id"]) if latest else None))
    return {"leaf": leaf, "from_project": from_project}


async def _new_project(conn: Any, user_id: UUID, name: str, goal: dict[str, Any], tab_ref: str) -> tuple[UUID, UUID]:
    """A user-made tree: the project and its placeholder cluster (no analysis run: marks it the user's)."""
    project_id = await conn.fetchval("INSERT INTO projects (user_id, name, last_active_at) VALUES ($1, $2, now()) "
                                     "RETURNING id", user_id, name)
    cluster_id = await conn.fetchval(
        "INSERT INTO intent_clusters (user_id, project_id, analysis_run_id, label, goal_id, goal, goal_provenance, "
        "goal_confidence, goal_evidence, goal_user_note_id, fogged, important_tab_refs) "
        "VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::uuid[]) RETURNING id",
        user_id, project_id, name, UUID(goal["id"][2:]), goal["text"], goal["provenance"], goal["confidence"],
        _j(goal["evidence"]), UUID(goal["user_note_id"][2:]) if goal.get("user_note_id") else None,
        goal["provenance"] == "hypothesis", [UUID(tab_ref)])
    return project_id, cluster_id


def _new_tree_json(project_id: UUID, name: str, goal: dict[str, Any], leaf: dict[str, Any]) -> dict[str, Any]:
    return {"project_id": f"p_{project_id}", "name": name, "is_existing_project_id": None, "goal": goal,
            "attention_min": round(leaf["dwell_min"]), "days_since_active": 0, "canopy": "green",
            "fogged": goal["provenance"] == "hypothesis",
            "branches": [{"label": "All tabs", "status": "active", "leaves": [leaf]}], "direction": None,
            "stones": [], "mushrooms": [], "next_actions": [], "vines": [], "hypotheses": [], "query_families": [],
            "important_tab_refs": [leaf["tab_ref"]], "shared_tab_refs": []}


async def _pin_tab(conn: Any, user_id: UUID, cluster_id: UUID, tab_ref: str, label: str | None,
                   importance: float, create_branch: bool = True) -> str | None:
    """cluster_tabs row with assigned_by='user' (a pin: the next grow keeps the tab here)."""
    branch_id, used = None, None
    if label:
        row = await conn.fetchrow("SELECT id, label FROM intent_branches WHERE user_id = $1 AND cluster_id = $2 "
                                  "AND lower(label) = lower($3)", user_id, cluster_id, label)
        if row is None and create_branch:
            n = await conn.fetchval("SELECT count(*) FROM intent_branches WHERE user_id = $1 AND cluster_id = $2",
                                    user_id, cluster_id)
            row = await conn.fetchrow("INSERT INTO intent_branches (user_id, cluster_id, label, status, position) "
                                      "VALUES ($1, $2, $3, 'explored', $4) RETURNING id, label", user_id, cluster_id,
                                      label, n)
        if row is not None:
            branch_id, used = row["id"], row["label"]
    await conn.execute(
        "INSERT INTO cluster_tabs (user_id, cluster_id, branch_id, tab_ref, importance, assigned_by, fallen, position) "
        "VALUES ($1, $2, $3, $4, $5, 'user', false, 0) ON CONFLICT (cluster_id, tab_ref) DO UPDATE SET "
        "branch_id = excluded.branch_id, assigned_by = 'user', assigned_at = now(), importance = excluded.importance",
        user_id, cluster_id, branch_id, UUID(tab_ref), importance)
    return used


async def assign_tab(pool: Any, user_id: UUID, tab_ref: str, body: AssignRequest,
                     stats: StatsSource | None = None) -> tuple[dict[str, Any], int]:
    need_db(pool)
    if not _UUID.match(tab_ref.lower()):
        raise not_found("Tab")
    tab_ref = tab_ref.lower()
    stats = stats or get_stats_source()
    async with pool.acquire() as conn, conn.transaction():
        grove_row = await last_grove_row(conn, user_id, lock=True)
        grove = grove_row["response"] if grove_row else None
        facts = await _tab_facts(conn, user_id, tab_ref, grove, grove_row["snapshot"] if grove_row else None, stats)
        if facts is None:
            raise not_found("Tab")
        leaf = facts["leaf"]
        created = body.new_project_name is not None
        if created:
            goal_text = f"Tabs about {body.new_project_name}"
            goal = {"id": f"g_{uuid.uuid4()}", "text": goal_text, "provenance": "hypothesis",
                    "confidence": NEW_TREE_GOAL_CONFIDENCE, "display_text": display_text("goal", "hypothesis", goal_text),
                    "evidence": [{"ref_kind": "tab", "ref": tab_ref, "why": "moved here by you"}], "user_note_id": None}
            project_id, cluster_id = await _new_project(conn, user_id, body.new_project_name, goal, tab_ref)
            name, branch = body.new_project_name, None
            await _pin_tab(conn, user_id, cluster_id, tab_ref, "All tabs", leaf["importance"])
            tree = _new_tree_json(project_id, name, goal, {**leaf, "fallen": False})
        else:
            pid = split_id(body.project_id, ("p_",))
            project = await conn.fetchrow("SELECT id, name FROM projects WHERE user_id = $1 AND id = $2", user_id,
                                          pid[1]) if pid else None
            if project is None:
                raise not_found("Project")
            project_id, name = project["id"], project["name"]
            cluster_id = await conn.fetchval("SELECT id FROM intent_clusters WHERE user_id = $1 AND project_id = $2 "
                                             "ORDER BY created_at DESC LIMIT 1", user_id, project_id)
            if cluster_id is None:
                raise not_found("Project")
            branch = await _pin_tab(conn, user_id, cluster_id, tab_ref, body.branch_label, leaf["importance"])
            tree = None
        from_id = facts["from_project"] or str(project_id)
        if grove is not None:
            ge.take_tab(grove, tab_ref)
            if created:
                grove["trees"].append(tree)
            else:
                dest = ge.find_tree(grove, f"p_{project_id}")
                if dest is not None:
                    ge.add_leaf(dest, {**leaf, "fallen": False}, body.branch_label)
            await conn.execute("UPDATE analysis_runs SET response = $3::jsonb WHERE user_id = $1 AND run_id = $2",
                               user_id, grove_row["run_id"], _j(grove))
        reanalyze = list(dict.fromkeys([f"p_{from_id}", f"p_{project_id}"]))
    return ({"tab_ref": tab_ref, "from_project_id": f"p_{from_id}", "project_id": f"p_{project_id}",
             "project_name": name, "branch_label": branch, "assigned_by": "user", "pinned": True,
             "reanalyze_project_ids": reanalyze}, 201 if created else 200)


async def create_note(pool: Any, user_id: UUID, body: NoteCreateRequest,
                      stats: StatsSource | None = None) -> dict[str, Any]:
    """POST /api/notes. goal + a tab in the fog/meadow: the tab gets its own tree named by the user;
    goal + a tab (or a project) in a tree: that tree's goal becomes stated; decision: a carved stone."""
    need_db(pool)
    stats = stats or get_stats_source()
    async with pool.acquire() as conn, conn.transaction():
        grove_row = await last_grove_row(conn, user_id, lock=True)
        grove = grove_row["response"] if grove_row else None
        tab_ref = body.tab_ref.lower() if body.tab_ref else None
        project_id: UUID | None = None
        tree: dict[str, Any] | None = None
        facts = None
        if body.project_id:
            pid = split_id(body.project_id, ("p_",))
            if pid is None or await conn.fetchval("SELECT 1 FROM projects WHERE user_id = $1 AND id = $2", user_id,
                                                  pid[1]) is None:
                raise not_found("Project")
            project_id = pid[1]
        if tab_ref:
            facts = await _tab_facts(conn, user_id, tab_ref, grove, grove_row["snapshot"] if grove_row else None, stats)
            if facts is None:
                raise not_found("Tab")
            if project_id is None and facts["from_project"] and grove and ge.find_leaf(grove, tab_ref):
                project_id = UUID(facts["from_project"])
        loose = project_id is None  # a tab outside every tree
        if loose and body.kind != "goal":
            raise ProblemError(422, "Unprocessable Entity",
                               "This tab is in no tree: give project_id, or use kind goal to give it a tree")
        tab_uuid = UUID(tab_ref) if tab_ref else None

        if loose:  # name the goal of a fogged or loose tab: a new tree of the user's own
            name = body.text.strip()[:60]
            note_id = uuid.uuid4()
            goal = {"id": f"g_{uuid.uuid4()}", "text": body.text, "provenance": "stated", "confidence": 1.0,
                    "display_text": body.text,
                    "evidence": [{"ref_kind": "note", "ref": f"n_{note_id}", "why": "user named this goal"},
                                 {"ref_kind": "tab", "ref": tab_ref, "why": "the tab the user cleared from the fog"}],
                    "user_note_id": f"n_{note_id}"}
            project_id, cluster_id = await _new_project(conn, user_id, name, goal, tab_ref)
            row = await conn.fetchrow(
                "INSERT INTO user_notes (id, user_id, project_id, cluster_id, tab_ref, kind, text) "
                "VALUES ($1, $2, $3, $4, $5, 'goal', $6) RETURNING id, created_at",
                note_id, user_id, project_id, cluster_id, tab_uuid, body.text)
            await _pin_tab(conn, user_id, cluster_id, tab_ref, "All tabs", facts["leaf"]["importance"])
            if grove is not None:
                ge.take_tab(grove, tab_ref)
                grove["trees"].append(_new_tree_json(project_id, name, goal, {**facts["leaf"], "fallen": False}))
            claim = goal
        else:
            cluster_id = await conn.fetchval("SELECT id FROM intent_clusters WHERE user_id = $1 AND project_id = $2 "
                                             "ORDER BY created_at DESC LIMIT 1", user_id, project_id)
            tree = ge.find_tree(grove, f"p_{project_id}") if grove else None
            note_uuid, created_at = await _insert_note(conn, user_id, project_id, cluster_id, body.kind, body.text,
                                                       tab_uuid)
            row = {"id": note_uuid, "created_at": created_at}
            api_note = f"n_{note_uuid}"
            evidence = [{"ref_kind": "note", "ref": api_note,
                         "why": {"goal": "user named this goal", "decision": "user note", "note": "user note"}[body.kind]}]
            if body.kind == "goal":
                if tree is not None:
                    goal_id = UUID(tree["goal"]["id"][2:])
                    old = tree["goal"]
                else:
                    goal_id = await conn.fetchval("SELECT goal_id FROM intent_clusters WHERE id = $1", cluster_id)
                    old = {"evidence": []}
                if tab_ref:
                    evidence.append({"ref_kind": "tab", "ref": tab_ref, "why": "the tab the user cleared from the fog"})
                evidence += [e for e in old["evidence"] if e not in evidence][:3]
                await conn.execute(
                    "UPDATE intent_clusters SET goal = $3, goal_provenance = 'stated', goal_confidence = 1, "
                    "goal_evidence = $4::jsonb, goal_user_note_id = $5, fogged = false "
                    "WHERE user_id = $1 AND goal_id = $2", user_id, goal_id, body.text, _j(evidence), note_uuid)
                claim = {"id": f"g_{goal_id}", "text": body.text, "provenance": "stated", "confidence": 1.0,
                         "display_text": body.text, "evidence": evidence, "user_note_id": api_note}
                if tree is not None:
                    tree["goal"], tree["fogged"] = claim, False
            elif body.kind == "decision":
                stone_id = uuid.uuid4()
                await conn.execute(
                    "INSERT INTO decisions (id, user_id, cluster_id, text, provenance, confidence, evidence, "
                    "user_note_id, confirmed_at) VALUES ($1, $2, $3, $4, 'stated', 1, $5::jsonb, $6, now())",
                    stone_id, user_id, cluster_id, body.text, _j(evidence), note_uuid)
                claim = {"id": f"dec_{stone_id}", "text": body.text, "provenance": "stated", "confidence": 1.0,
                         "display_text": body.text, "evidence": evidence, "user_note_id": api_note}
                if tree is not None:
                    tree["stones"].insert(0, {**claim, "kind": "carved", "quote": None})
            else:
                claim = {"id": api_note, "text": body.text, "provenance": "stated", "confidence": 1.0,
                         "display_text": body.text, "evidence": evidence, "user_note_id": api_note}
        if grove is not None:
            await conn.execute("UPDATE analysis_runs SET response = $3::jsonb WHERE user_id = $1 AND run_id = $2",
                               user_id, grove_row["run_id"], _j(grove))
    return {"note": {"id": f"n_{row['id']}", "kind": body.kind, "tab_ref": tab_ref, "text": body.text,
                     "created_at": _iso(row["created_at"])},
            "project_id": f"p_{project_id}", "claim": claim}


# ---------------------------------------------------------------------------------------
# Analyze one project
# ---------------------------------------------------------------------------------------

async def analyze_project(pool: Any, client: Any, user_id: UUID, project_api_id: str, *,
                          stats: StatsSource | None = None, model_name: str | None = None) -> dict[str, Any]:
    """Re-run inference for one project's current tabs (pins, notes and dismissals are honoured by the
    same carry-over as a grow). The tree replaces the project's tree in the stored grove. If the model is
    unavailable the project is left as it is (503): a stale tree is better than a groups-only one."""
    need_db(pool)
    pid = split_id(project_api_id, ("p_",))
    if pid is None:
        raise not_found("Project")
    async with pool.acquire() as conn:
        if await conn.fetchval("SELECT 1 FROM projects WHERE user_id = $1 AND id = $2", user_id, pid[1]) is None:
            raise not_found("Project")
        over = budget_exceeded(*await usage_today(conn, user_id))
        if over:
            raise ProblemError(429, "Too Many Requests", over)
        grove_row = await last_grove_row(conn, user_id)
    tree = ge.find_tree(grove_row["response"], f"p_{pid[1]}") if grove_row else None
    if tree is None:
        raise not_found("Project in the current grove")
    snapshot = grove_row["snapshot"]
    if not snapshot:
        raise ProblemError(409, "Conflict", "No stored snapshot for this grove; grow it again first")
    refs = [leaf["tab_ref"] for _, leaf in ge.iter_leaves(tree)]
    tabs = [t for t in snapshot["open_tabs"] if t["tab_ref"] in set(refs)]
    if not tabs:
        raise ProblemError(409, "Conflict", "The project's tabs are not in the stored snapshot")
    snapshot_at = datetime.fromisoformat(snapshot["snapshot_at"])
    pins = await load_pins(pool, user_id, [t["tab_ref"] for t in tabs])
    try:
        vectors = (await embed_tabs(user_id, [normalize_tab(t) for t in tabs], pool, client=client)).vectors
        mean = sum(vectors[t["tab_ref"]] for t in tabs) / len(tabs)
        centroid = [float(x) for x in mean / max(float((mean @ mean) ** 0.5), 1e-12)]
    except Exception as exc:  # noqa: BLE001 - prior research needs a centroid; the analysis does not
        log.warning("analyze: no centroid (%s)", type(exc).__name__)
        centroid = []
    cluster = Cluster(id=str(pid[1]), tab_refs=[t["tab_ref"] for t in tabs], label=top_terms(t["title"] for t in tabs),
                      centroid=centroid, pinned_tab_refs=[r for r, p in pins.items() if p == str(pid[1])],
                      is_existing_project_id=str(pid[1]), earliest_opened_at=min(str(t["opened_at"]) for t in tabs))
    run = GrowRun(user_id, tabs, 0, pool=pool, client=client, snapshot_at=snapshot_at, stats=stats,
                  model_name=model_name)
    t0 = time.perf_counter()
    prepared = await run.prepare_clusters([cluster])
    outcome = await infer_cluster(cluster.id, prepared[cluster.id][1], client)
    build = run.build_tree(outcome, cluster, str(pid[1]), prepared[cluster.id], set(tree["shared_tab_refs"]))
    if run.report.fallbacks:
        raise ProblemError(503, "Service Unavailable", "AI is unavailable right now; the tree is unchanged",
                           headers={"Retry-After": "30"})
    Tree.model_validate(build.tree)
    run.report.latency_ms = round((time.perf_counter() - t0) * 1000)
    r = run.report
    analysis_id = uuid.uuid4()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "INSERT INTO analysis_runs (run_id, user_id, kind, clusters, model, latency_ms, llm_calls, tokens, "
            "downgraded_claims, fallback_used, degraded) VALUES ($1, $2, 'analyze_project', 1, $3, $4, $5, $6, $7, "
            "false, false)", analysis_id, user_id, model_name, r.latency_ms, r.llm_calls, r.tokens, len(r.downgrades))
        await persist_build(conn, user_id, analysis_id, build)
        latest = await last_grove_row(conn, user_id, lock=True)
        if latest and ge.replace_tree(latest["response"], build.tree):
            await conn.execute("UPDATE analysis_runs SET response = $3::jsonb WHERE user_id = $1 AND run_id = $2",
                               user_id, latest["run_id"], _j(latest["response"]))
    return build.tree
