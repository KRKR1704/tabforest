"""Throwaway Postgres for the full-stack test: embedded Postgres 16 with pgvector, the repo's migrations adapted for
plain Postgres (no TimescaleDB: hypertable, policies and the diskann index are left out, the continuous aggregates
become live views like TimescaleDB's real-time aggregates). Nothing here touches a shared database.

    uv run --with pgserver --with asyncpg python harness.py <db/migrations dir> <command ...>

Runs <command> with DATABASE_URL pointing at the throwaway database, then deletes it."""
import asyncio, os, re, shutil, socket, subprocess, sys, tempfile
from pathlib import Path
import asyncpg, pgserver

MIGRATIONS = Path(sys.argv[1])
CMD = sys.argv[2:]

def adapt(sql: str) -> str:
    sql = re.sub(r"DO \$\$.*?\$\$;", "", sql, flags=re.S)
    sql = re.sub(r"SELECT create_hypertable\([^;]*\);", "", sql, flags=re.S)
    sql = re.sub(r"SELECT add_[a-z_]+\([^;]*\);", "", sql, flags=re.S)
    sql = re.sub(r"CREATE INDEX IF NOT EXISTS [a-z_]+\s+ON memory_embeddings USING diskann[^;]*;", "", sql, flags=re.S)
    sql = re.sub(r"WITH \(timescaledb[^)]*\) AS", "AS", sql)
    sql = sql.replace("WITH NO DATA;", ";")
    sql = sql.replace("CREATE MATERIALIZED VIEW IF NOT EXISTS", "CREATE OR REPLACE VIEW")  # real-time like TimescaleDB
    return sql

STUBS = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE FUNCTION time_bucket(i interval, t timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
  $$ SELECT date_bin(i, t, TIMESTAMPTZ '2000-01-03 00:00:00+00') $$;
CREATE PROCEDURE refresh_continuous_aggregate(v regclass, a timestamptz, b timestamptz) LANGUAGE plpgsql AS
  $$ BEGIN NULL; END $$;
"""

async def load(uri):
    c = await asyncpg.connect(uri)
    await c.execute(STUBS)
    for f in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        await c.execute(adapt(f.read_text()))
    await c.close()

d = tempfile.mkdtemp()
srv = pgserver.get_server(d)
sock_uri = srv.get_uri()  # unix socket; the loader uses it directly


def start_tcp_proxy(socket_dir: str) -> int:
    """127.0.0.1:<port> -> the unix socket. The API refuses a remote database without sslmode=require (P-13) and
    treats only localhost addresses as local, so it gets a loopback TCP address instead of the socket."""
    import socketserver, threading
    sock_path = os.path.join(socket_dir, ".s.PGSQL.5432")

    def pipe(a, b):
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for x in (a, b):
                try:
                    x.shutdown(2)
                except OSError:
                    pass

    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            up = socket.socket(socket.AF_UNIX); up.connect(sock_path)
            t = threading.Thread(target=pipe, args=(up, self.request), daemon=True); t.start()
            pipe(self.request, up); t.join(1)

    class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True; daemon_threads = True

    server = Server(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_address[1]


socket_dir = re.search(r"host=([^&]+)", sock_uri).group(1)
uri = f"postgresql://postgres@127.0.0.1:{start_tcp_proxy(socket_dir)}/postgres"
try:
    asyncio.run(load(sock_uri))
    print("schema loaded", flush=True)
    env = {**os.environ, "DATABASE_URL": uri}
    sys.exit(subprocess.call(CMD, env=env))
finally:
    srv.cleanup()
    shutil.rmtree(d, ignore_errors=True)  # the data directory is not removed by cleanup()
