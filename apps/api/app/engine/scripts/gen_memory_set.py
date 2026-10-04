r"""Generate the labeled research-memory set for the search threshold (R-12).

Run from the repo root:
    apps\api\.venv\Scripts\python apps\api\app\engine\scripts\gen_memory_set.py

Writes apps/api/app/engine/fixtures/memory_set.json: 14 past-research insights (written the way memory.py and the demo
seed write them: "Researched X. Compared A with B. Concluded that ... Rejected ... Still open: ...") and labeled queries.
  relevant   the query should find this insight (paraphrases, a keyword, a question)
  related    same area as an insight but a different question: must NOT hit it
  unrelated  nothing in memory: must not hit anything
The demo's "session storage" -> Backend Scaling and "recipe" -> nothing are in the set on purpose.
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "memory_set.json"

INSIGHTS = [
    ("backend_scaling", "Researched session storage for the backend. Compared Redis with Postgres-backed sessions. "
     "Concluded that Redis not needed at expected scale; Postgres sessions are enough. "
     "Rejected Redis for now because it adds a service to run and secure."),
    ("lisbon_trip", "Researched a Lisbon trip. Compared staying in Alfama, Baixa and Bairro Alto. Concluded that Alfama is "
     "the best base for two nights. Looked at the train from Lisbon to Sintra for a day trip and the tram 28 route. "
     "Still open: whether to buy the Lisboa Card."),
    ("laptop", "Researched a new laptop for programming. Compared the MacBook Air 15 with the Dell XPS 14 on battery life, "
     "keyboard and price. Concluded that battery life matters most and the MacBook Air wins. Rejected the XPS for its fan noise."),
    ("kubernetes", "Researched why pods keep restarting in Kubernetes. Looked at CrashLoopBackOff causes, kubectl logs, "
     "kubectl describe and kubectl port-forward versus NodePort. Concluded that a missing environment variable crashed the "
     "container. Still open: how to set resource limits."),
    ("nextjs", "Researched migrating a site to Next.js 15. Compared the Pages Router with the App Router, and Webpack with "
     "Turbopack. Concluded to move to the App Router and enable Turbopack in development. Still open: how to handle server "
     "actions and caching."),
    ("interviews", "Researched preparing for backend engineer interviews. Compared system design resources and LeetCode "
     "practice plans. Concluded to practice LRU cache and rate limiter questions first. Still open: how to answer behavioral "
     "questions about conflict."),
    ("espresso", "Researched buying a home espresso machine. Compared the Gaggia Classic Pro with the Breville Bambino and a "
     "manual lever. Concluded that a Gaggia with a separate grinder gives the best shots for the budget. Rejected the pod machines."),
    ("rust", "Researched learning Rust for command line tools. Looked at ownership, borrowing and lifetimes, and compared Rust "
     "with Go. Concluded that ownership is the hard part and Go is faster to ship. Still open: when to use async and tokio."),
    ("postgres_perf", "Researched slow queries in PostgreSQL. Looked at indexes, EXPLAIN ANALYZE, VACUUM and table partitioning. "
     "Concluded that a missing composite index caused the slow report. Rejected partitioning for now because the table is small."),
    ("tomatoes", "Researched growing tomatoes on a balcony. Compared determinate and indeterminate varieties and container "
     "sizes. Concluded to grow cherry tomatoes in twenty litre pots. Still open: how often to water in summer."),
    ("hackathon", "Researched preparing for a hackathon. Looked at the Devpost rules, MLH guidelines and free Azure student "
     "credits. Concluded to build a browser extension with a FastAPI backend. Still open: which sponsor prizes to target."),
    ("mortgage", "Researched refinancing a mortgage. Compared a fixed 30 year rate with a 15 year rate and the closing costs. "
     "Concluded that refinancing pays off after four years. Rejected an adjustable rate loan as too risky."),
    ("d3_tree", "Researched drawing a tree diagram with D3. Looked at d3-hierarchy, treemap and tidy tree layouts and SVG "
     "transitions. Concluded that d3.tree with SVG paths is enough. Still open: how to animate leaves falling."),
    ("bike", "Researched buying a commuter bike. Compared a steel frame, an aluminium frame and an e-bike on weight and price. "
     "Concluded that an aluminium frame with disc brakes fits a daily ten kilometre commute."),
]

# (text, label, relevant insight ids)
QUERIES = [
    ("session storage", "relevant", ["backend_scaling"]), ("redis vs postgres sessions", "relevant", ["backend_scaling"]),
    ("do I need redis", "relevant", ["backend_scaling"]), ("have I researched redis before", "relevant", ["backend_scaling"]),
    ("lisbon trip", "relevant", ["lisbon_trip"]), ("sintra day trip", "relevant", ["lisbon_trip"]),
    ("where to stay in lisbon", "relevant", ["lisbon_trip"]),
    ("new laptop for coding", "relevant", ["laptop"]), ("macbook air vs xps", "relevant", ["laptop"]),
    ("kubernetes pods restarting", "relevant", ["kubernetes"]), ("crashloopbackoff", "relevant", ["kubernetes"]),
    ("next.js 15 migration", "relevant", ["nextjs"]), ("turbopack", "relevant", ["nextjs"]),
    ("backend interview prep", "relevant", ["interviews"]), ("lru cache interview question", "relevant", ["interviews"]),
    ("espresso machine", "relevant", ["espresso"]), ("gaggia classic", "relevant", ["espresso"]),
    ("learning rust", "relevant", ["rust"]), ("rust ownership", "relevant", ["rust"]),
    ("postgres slow query", "relevant", ["postgres_perf"]), ("explain analyze", "relevant", ["postgres_perf"]),
    ("growing tomatoes", "relevant", ["tomatoes"]), ("balcony garden", "relevant", ["tomatoes"]),
    ("hackathon prep", "relevant", ["hackathon"]), ("azure student credits", "relevant", ["hackathon"]),
    ("refinance mortgage", "relevant", ["mortgage"]), ("d3 tree layout", "relevant", ["d3_tree"]),
    ("commuter bike", "relevant", ["bike"]), ("aluminium vs steel bike frame", "relevant", ["bike"]),
    ("what did I decide about the espresso grinder", "relevant", ["espresso"]),
    # same area, different question: must not hit
    ("jwt refresh token storage", "related", []), ("api rate limiting design", "related", []),
    ("tokyo itinerary", "related", []), ("gaming desktop build", "related", []),
    ("kubernetes ingress nginx setup", "related", []), ("react server components", "related", []),
    ("salary negotiation tips", "related", []), ("pour over coffee grinder", "related", []),
    ("learning python decorators", "related", []), ("mysql replication lag", "related", []),
    ("indoor herb garden", "related", []), ("pitching a startup idea", "related", []),
    ("car loan interest rates", "related", []), ("chart.js bar chart", "related", []),
    ("electric scooter reviews", "related", []),
    # nothing in memory
    ("recipe", "unrelated", []), ("weather tomorrow", "unrelated", []), ("how to tie a tie", "unrelated", []),
    ("bitcoin price", "unrelated", []), ("football scores", "unrelated", []), ("guitar chords for wonderwall", "unrelated", []),
    ("car insurance quote", "unrelated", []), ("movie showtimes", "unrelated", []), ("best pizza near me", "unrelated", []),
    ("dentist appointment", "unrelated", []), ("flight status", "unrelated", []), ("meditation for beginners", "unrelated", []),
]


def build() -> dict:
    return {"about": "Labeled research-memory set for the search threshold (generated by app/engine/scripts/gen_memory_set.py). "
                     "relevant = should find the insight; related = same area, different question; unrelated = nothing in memory.",
            "insights": [{"id": i, "summary": s} for i, s in INSIGHTS],
            "queries": [{"text": t, "label": l, "relevant": r} for t, l, r in QUERIES]}


def main() -> None:
    data = build()
    OUT.write_bytes((json.dumps(data, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))
    counts = {k: sum(q["label"] == k for q in data["queries"]) for k in ("relevant", "related", "unrelated")}
    print(f"wrote {OUT.name}: {len(data['insights'])} insights, {len(data['queries'])} queries {counts}")


if __name__ == "__main__":
    main()
