r"""Generate the labeled tab-title pairs for the semantic-redundancy threshold (audit fix 4).

Run from the repo root:
    apps\api\.venv\Scripts\python apps\api\app\engine\scripts\gen_title_pairs.py

Writes apps/api/app/engine/fixtures/title_pairs.json: tabs (topic, group, title, domain) and labeled pairs.
  redundant  same topic and same group: two pages that cover the same ground, so one can be closed
  related    same topic, different group: same subject, different content (a different question, section or angle)
  unrelated  different topics (sampled, only pairs of the same leaf type, the only ones the rule ever compares)
The demo's own tab titles are deliberately not in this set, so the demo check shows the threshold generalizes.
"""

import json
from itertools import combinations
from pathlib import Path

from app.engine.normalize import classify_source, leaf_source_type

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "title_pairs.json"
UNRELATED_EVERY = 6  # keep every 6th same-type cross-topic pair: ~100 pairs, deterministic

# (topic, group, title, domain)
TABS = [
    # --- authentication articles
    ("auth", "jwt_tutorial", "Build secure login with JWT in a Python web API: a step-by-step guide", "medium.com"),
    ("auth", "jwt_tutorial", "JSON Web Token authentication for Python APIs, explained", "dev.to"),
    ("auth", "jwt_tutorial", "Implement JWT login for your Python API, step by step", "hashnode.dev"),
    ("auth", "oauth_primer", "OAuth 2.0 explained in plain English", "medium.com"),
    ("auth", "oauth_primer", "A beginner's guide to OAuth2 and OpenID Connect", "dev.to"),
    ("auth", "session_vs_token", "Sessions vs tokens: which one should your API use?", "medium.com"),
    ("auth", "session_vs_token", "Server-side sessions or JWT? A practical comparison", "dev.to"),
    ("auth", "cookie_flags", "HttpOnly, Secure and SameSite cookies: what each flag does", "medium.com"),
    ("auth", "cookie_flags", "How to set secure cookies for your web app", "dev.to"),
    # --- authentication Q&A, code, docs
    ("auth", "qa_jwt_session", "JWT vs session-based authentication for a REST API", "stackoverflow.com"),
    ("auth", "qa_jwt_session", "Session authentication versus token authentication: which is better?", "stackoverflow.com"),
    ("auth", "qa_refresh_storage", "Where should I store a refresh token in a single page app?", "stackoverflow.com"),
    ("auth", "qa_refresh_storage", "Is it safe to keep the refresh token in localStorage?", "stackoverflow.com"),
    ("auth", "qa_bcrypt", "How to hash passwords with bcrypt in Python", "stackoverflow.com"),
    ("auth", "code_jwt_example", "jwt-auth-example: login, refresh and protected routes", "github.com"),
    ("auth", "code_jwt_example", "jwt-example-api: access and refresh tokens with a protected route", "github.com"),
    ("auth", "code_template", "full-stack-template: production ready API project with a React frontend", "github.com"),
    ("auth", "docs_fastapi_security", "OAuth2 with Password (and hashing), Bearer with JWT tokens - FastAPI", "fastapi.tiangolo.com"),
    ("auth", "docs_fastapi_other", "Dependencies - FastAPI", "fastapi.tiangolo.com"),
    ("auth", "docs_fastapi_other", "Background Tasks - FastAPI", "fastapi.tiangolo.com"),
    ("auth", "docs_ms_oauth", "OAuth 2.0 authorization code flow - Microsoft identity platform", "learn.microsoft.com"),
    ("auth", "docs_ms_other", "Microsoft identity platform and OpenID Connect protocol", "learn.microsoft.com"),
    # --- Next.js articles
    ("nextjs", "turbopack", "Getting started with Turbopack in Next.js 15", "medium.com"),
    ("nextjs", "turbopack", "Speed up your Next.js builds with Turbopack", "dev.to"),
    ("nextjs", "app_router_data", "Data fetching in the Next.js App Router, explained", "medium.com"),
    ("nextjs", "app_router_data", "Next.js App Router: fetch, cache and revalidate", "dev.to"),
    ("nextjs", "server_actions", "Next.js Server Actions: a complete guide", "medium.com"),
    ("nextjs", "server_actions", "Using Server Actions for form handling in Next.js", "hashnode.dev"),
    # --- Kubernetes articles and docs
    ("k8s", "port_forward", "kubectl port-forward explained", "medium.com"),
    ("k8s", "port_forward", "How kubectl port-forward works under the hood", "dev.to"),
    ("k8s", "crashloop", "Debugging CrashLoopBackOff in Kubernetes", "medium.com"),
    ("k8s", "crashloop", "Why your Kubernetes pods keep restarting", "dev.to"),
    ("k8s", "service_types", "Kubernetes Services: ClusterIP, NodePort and LoadBalancer", "medium.com"),
    ("k8s", "service_types", "Understanding Kubernetes service types", "hashnode.dev"),
    ("k8s", "docs_service", "Service | Kubernetes", "kubernetes.io"),
    ("k8s", "docs_pods", "Pods | Kubernetes", "kubernetes.io"),
    ("k8s", "docs_deployments", "Deployments | Kubernetes", "kubernetes.io"),
    # --- PostgreSQL articles
    ("postgres", "indexes", "A practical guide to PostgreSQL indexes", "medium.com"),
    ("postgres", "indexes", "PostgreSQL indexing explained with examples", "dev.to"),
    ("postgres", "vacuum", "What VACUUM does in PostgreSQL and when it matters", "medium.com"),
    ("postgres", "vacuum", "Understanding autovacuum in Postgres", "dev.to"),
    ("postgres", "partitioning", "Table partitioning in PostgreSQL: when and how", "medium.com"),
    ("postgres", "partitioning", "Partitioning large Postgres tables", "hashnode.dev"),
    # --- Rust articles and docs
    ("rust", "ownership", "Rust ownership explained visually", "medium.com"),
    ("rust", "ownership", "Understanding ownership and borrowing in Rust", "dev.to"),
    ("rust", "async", "Async Rust in practice: tokio basics", "medium.com"),
    ("rust", "async", "A gentle introduction to async/await in Rust", "dev.to"),
    ("rust", "docs_ownership", "What is Ownership? - The Rust Programming Language", "doc.rust-lang.org"),
    ("rust", "docs_ownership", "Understanding Ownership - The Rust Programming Language", "doc.rust-lang.org"),
    ("rust", "docs_lifetimes", "Validating References with Lifetimes - The Rust Programming Language", "doc.rust-lang.org"),
    # --- Lisbon travel articles
    ("lisbon", "sintra", "Day trip from Lisbon to Sintra by train", "medium.com"),
    ("lisbon", "sintra", "How to visit Sintra from Lisbon in one day", "substack.com"),
    ("lisbon", "stay", "Where to stay in Lisbon: the best neighborhoods", "medium.com"),
    ("lisbon", "stay", "Best areas to book a hotel in Lisbon", "substack.com"),
    ("lisbon", "food", "What to eat in Lisbon: a food lover's guide", "medium.com"),
    ("lisbon", "food", "Lisbon food guide: pasteis, petiscos and more", "substack.com"),
    # --- recipes
    ("recipes", "chicken", "One-Pan Lemon Garlic Chicken and Potatoes Recipe", "www.allrecipes.com"),
    ("recipes", "chicken", "Easy Lemon Garlic Chicken Thighs Recipe", "www.allrecipes.com"),
    ("recipes", "curry", "Easy Chickpea Curry Recipe", "www.allrecipes.com"),
    ("recipes", "curry", "Quick Chickpea Curry in 20 Minutes", "www.allrecipes.com"),
    ("recipes", "carbonara", "Classic Spaghetti Carbonara Recipe", "www.allrecipes.com"),
    # --- discussions
    ("discussion", "rust_vs_go", "Rust vs Go for a small CLI tool?", "www.reddit.com"),
    ("discussion", "rust_vs_go", "Go or Rust for a command line tool?", "www.reddit.com"),
    ("discussion", "laptops", "MacBook Air or Dell XPS for programming?", "www.reddit.com"),
    ("discussion", "jwt_overkill", "Is JWT overkill for a side project?", "www.reddit.com"),
]


def build() -> dict:
    tabs = [{"id": f"t{i:02d}", "topic": t, "group": g, "title": title, "domain": d,
             "leaf_type": leaf_source_type(classify_source(d, title)).value}
            for i, (t, g, title, d) in enumerate(TABS, 1)]
    pairs, skipped = [], 0
    for a, b in combinations(tabs, 2):
        if a["topic"] == b["topic"] and a["group"] == b["group"]:
            label = "redundant"
        elif a["topic"] == b["topic"]:
            label = "related"
        else:
            label = "unrelated"
        if label == "unrelated":
            if a["leaf_type"] != b["leaf_type"]:
                continue
            skipped += 1
            if skipped % UNRELATED_EVERY:
                continue
        pairs.append({"a": a["id"], "b": b["id"], "label": label})
    return {"about": "Labeled tab-title pairs for the semantic-redundancy threshold (generated by "
                     "app/engine/scripts/gen_title_pairs.py). redundant = same ground, related = same topic but different "
                     "content, unrelated = other topics (same leaf type only, sampled).",
            "tabs": tabs, "pairs": pairs}


def main() -> None:
    data = build()
    tabs, pairs = data["tabs"], data["pairs"]
    OUT.write_bytes((json.dumps(data, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))
    counts = {k: sum(p["label"] == k for p in pairs) for k in ("redundant", "related", "unrelated")}
    types = {t: sum(x["leaf_type"] == t for x in tabs) for t in sorted({x["leaf_type"] for x in tabs})}
    print(f"wrote {OUT.name}: {len(tabs)} tabs {types}, {len(pairs)} pairs {counts}")


if __name__ == "__main__":
    main()
