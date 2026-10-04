"""R-15: DbStats reads P's browser_events. Mapping, user isolation, attention sums and every fallback, with a fake
pool; plus the real SQL against a database when DATABASE_URL is set (skipped otherwise)."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app.engine.adapters.stats import DbStats, FixtureStats, TabAttention, get_stats_source
from app.engine.fixtures import load_events
from app.engine.settings import get_settings

USER = uuid.UUID("00000000-0000-4000-8000-0000000000f1")
OTHER = uuid.UUID("00000000-0000-4000-8000-0000000000f2")
NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
DEMO_REF = load_events()["events"][0]["tab_ref"]


def row(**kw):
    base = dict(event_id=uuid.uuid4(), ts=NOW, event_type="FOCUS", tab_ref=uuid.uuid4(), session_id=uuid.uuid4(),
                previous_tab_ref=None, active_ms=0, opener_tab_ref=None, domain="example.com", title="T",
                dup_key=None, search_query=None)
    return {**base, **kw}


class FakePool:
    def __init__(self, rows=None, error=None):
        self.rows, self.error, self.calls = rows or [], error, []

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        if self.error:
            raise self.error
        return self.rows


def run(coro):
    return asyncio.run(coro)


# --- fake pool: mapping and fallbacks ----------------------------------------------------------------

def test_a_stored_event_becomes_a_tab_event_with_text_ids() -> None:
    tab, prev, session = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    pool = FakePool([row(event_type="BLUR", tab_ref=tab, previous_tab_ref=prev, session_id=session, active_ms=42_000),
                     row(event_type="FOCUS", tab_ref=tab, active_ms=0)])
    blur, focus = run(DbStats(pool).events(USER, {str(tab)}))
    assert (blur.type, blur.tab_ref, blur.previous_tab_ref, blur.session_id, blur.active_ms) == (
        "BLUR", str(tab), str(prev), str(session), 42_000)
    assert focus.active_ms is None and focus.previous_tab_ref is None  # only a BLUR carries dwell
    sql, args = pool.calls[0]
    assert "user_id = $1" in sql and args[0] == USER and args[1] == [tab]


def test_refs_that_are_not_uuids_match_nothing_and_never_reach_the_query() -> None:
    pool = FakePool([])
    assert run(DbStats(pool).events(USER, {"not-a-uuid", "'; DROP TABLE x;--"})) == []
    assert pool.calls[0][1][1] == []


def test_attention_sums_dwell_counts_focuses_and_covers_every_asked_tab() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    pool = FakePool([{"tab_ref": a, "ms": 90_000, "focuses": 3, "last_focus": NOW}])
    got = run(DbStats(pool).attention(USER, {str(a), str(b)}))
    assert got[str(a)] == TabAttention(str(a), 90_000, 3, NOW)
    assert got[str(b)] == TabAttention(str(b), 0, 0, None)  # asked about, never seen: zeros, like the fixture source
    sql = pool.calls[0][0]
    assert "FILTER (WHERE event_type = 'BLUR')" in sql and "user_id = $1" in sql


@pytest.mark.parametrize("method,args", [("events", ({str(uuid.uuid4())},)), ("events_since", (NOW,)),
                                         ("attention", ({str(uuid.uuid4())},))])
def test_a_failing_query_falls_back_to_the_fixture_instead_of_breaking_the_run(method, args) -> None:
    stats = DbStats(FakePool(error=asyncpg.UndefinedTableError("no table")))
    expected = run(getattr(FixtureStats(), method)(USER, *args))
    assert run(getattr(stats, method)(USER, *args)) == expected


def test_the_demo_tabs_replay_from_fixtures_when_nothing_is_stored_but_real_tabs_stay_empty() -> None:
    stats = DbStats(FakePool([]))
    demo = run(stats.events(USER, {DEMO_REF}))
    assert demo and all(e.tab_ref == DEMO_REF for e in demo)
    assert run(stats.events_since(USER, NOW - timedelta(days=30)))  # the query-family window follows
    real = DbStats(FakePool([]))
    assert run(real.events(USER, {str(uuid.uuid4())})) == [] and run(real.events_since(USER, NOW)) == []
    assert run(real.attention(USER, {str(uuid.uuid4())})) != {}
    mixed = DbStats(FakePool([]))
    assert run(mixed.events(USER, {DEMO_REF, str(uuid.uuid4())})) == []  # one real tab: no demo replay
    some = DbStats(FakePool([row(tab_ref=uuid.UUID(DEMO_REF))]))
    assert len(run(some.events(USER, {DEMO_REF}))) == 1  # stored events win over the fixture


def test_get_stats_source_picks_the_database_only_when_there_is_one() -> None:
    assert isinstance(get_stats_source(), FixtureStats) and isinstance(get_stats_source(None), FixtureStats)
    assert isinstance(get_stats_source(FakePool()), DbStats)


# --- the real SQL ------------------------------------------------------------------------------------

needs_db = pytest.mark.skipif(not get_settings().db_configured, reason="DATABASE_URL not set")


async def _seed(conn: asyncpg.Connection, user: uuid.UUID, tab: uuid.UUID, other_tab: uuid.UUID):
    session = uuid.uuid4()
    await conn.execute("INSERT INTO browser_sessions (id, user_id, started_at, ended_at, event_count) "
                       "VALUES ($1, $2, $3, $3, 0)", session, user, NOW - timedelta(hours=3))
    for kind, minutes, ms, tref, prev in (("FOCUS", 0, 0, tab, None), ("BLUR", 5, 300_000, tab, None),
                                          ("FOCUS", 5, 0, other_tab, tab), ("BLUR", 7, 120_000, other_tab, None),
                                          ("FOCUS", 20, 0, tab, other_tab), ("BLUR", 24, 240_000, tab, None)):
        await conn.execute(
            "INSERT INTO browser_events (ts, user_id, event_id, session_id, tab_ref, event_type, active_ms, "
            "previous_tab_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            NOW - timedelta(hours=3) + timedelta(minutes=minutes), user, uuid.uuid4(), session, tref, kind, ms, prev)


@needs_db
def test_real_sql_reads_only_this_users_events_and_sums_their_dwell() -> None:
    tab, other_tab, foreign = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    async def go():
        conn = await asyncpg.connect(get_settings().database_url.get_secret_value())
        pool = await asyncpg.create_pool(get_settings().database_url.get_secret_value(), min_size=1, max_size=2)
        try:
            await conn.execute("INSERT INTO users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING", USER, OTHER)
            await _seed(conn, USER, tab, other_tab)
            await _seed(conn, OTHER, foreign, uuid.uuid4())
            stats = DbStats(pool)
            events = await stats.events(USER, {str(tab), str(other_tab)})
            att = await stats.attention(USER, {str(tab), str(other_tab), str(foreign)})
            since = await stats.events_since(USER, NOW - timedelta(hours=3) + timedelta(minutes=10))
            snooped = await stats.events(USER, {str(foreign)})
            return events, att, since, snooped
        finally:
            await pool.close()
            for u in (USER, OTHER):
                await conn.execute("DELETE FROM browser_events WHERE user_id = $1", u)
                await conn.execute("DELETE FROM browser_sessions WHERE user_id = $1", u)
                await conn.execute("DELETE FROM users WHERE id = $1", u)
            await conn.close()

    events, att, since, snooped = asyncio.run(go())
    assert [e.type for e in events] == ["FOCUS", "BLUR", "FOCUS", "BLUR", "FOCUS", "BLUR"]
    assert events[2].previous_tab_ref == str(tab) and events[1].active_ms == 300_000
    assert att[str(tab)].active_ms == 540_000 and att[str(tab)].focus_count == 2
    assert att[str(other_tab)].active_ms == 120_000 and att[str(foreign)] == TabAttention(str(foreign), 0, 0, None)
    assert snooped == []  # another user's tab is invisible even by its exact ref
    assert [e.type for e in since] == ["FOCUS", "BLUR"] and all(e.tab_ref == str(tab) for e in since)
