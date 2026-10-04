r"""Generate two hand-labeled snapshots for clustering calibration (R-5), in the §4.2 format.

Run from the repo root:
    apps\api\.venv\Scripts\python apps\api\app\engine\scripts\gen_cluster_snapshots.py

Writes apps/api/app/engine/fixtures/cluster_snapshots/{trip_laptops_thesis,nextjs_k8s_gift,burst_unrelated}.json:
{about, snapshot_at, open_tabs, labels}. labels maps tab_ref -> group name, or null for a tab
that belongs to no group (counts as a singleton for ARI). Groups interleave in time on purpose
(a gift tab opened a minute after a Kubernetes tab), so time adjacency alone cannot solve them.
"""

import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "cluster_snapshots"

# n, group, domain, title, url (hashed into dup_key, never stored), opener n, opened_at (HH:MM:SS), search query
TRIP_LAPTOPS_THESIS = ("2026-10-06", "21:00:00", [
    (1, "trip", "www.google.com", "lisbon 4 days itinerary - Google Search", "google.com/search?q=lisbon+4+days+itinerary", None, "18:02:10", "lisbon 4 days itinerary"),
    (2, "trip", "www.lonelyplanet.com", "Lisbon travel guide - Lonely Planet", "lonelyplanet.com/portugal/lisbon", 1, "18:02:41", None),
    (3, "trip", "www.booking.com", "Hotels in Alfama, Lisbon - Booking.com", "booking.com/district/pt/lisbon/alfama", None, "18:15:05", None),
    (4, "trip", "www.tripadvisor.com", "Pasteis de Belem, Lisbon - Restaurant Reviews - Tripadvisor", "tripadvisor.com/Restaurant_Review-g189158-d1023355", None, "18:21:44", None),
    (5, "trip", "www.google.com", "lisbon to sintra train - Google Search", "google.com/search?q=lisbon+to+sintra+train", None, "18:30:02", "lisbon to sintra train"),
    (6, "trip", "www.cp.pt", "Sintra line timetable | CP - Comboios de Portugal", "cp.pt/passageiros/en/train-times/sintra", 5, "18:30:20", None),
    (7, "trip", "www.skyscanner.net", "Cheap flights to Lisbon (LIS) | Skyscanner", "skyscanner.net/flights-to/lis/cheap-flights-to-lisbon-airport.html", None, "20:41:13", None),
    (8, "laptops", "www.google.com", "best laptop for programming 2026 - Google Search", "google.com/search?q=best+laptop+for+programming+2026", None, "19:05:00", "best laptop for programming 2026"),
    (9, "laptops", "www.rtings.com", "The 6 Best Laptops For Programming - Fall 2026: Reviews - RTINGS.com", "rtings.com/laptop/reviews/best/programming", 8, "19:05:31", None),
    (10, "laptops", "www.apple.com", "MacBook Air 15-inch - Tech Specs - Apple", "apple.com/macbook-air/specs", 9, "19:09:12", None),
    (11, "laptops", "www.dell.com", "XPS 14 Laptop | Dell USA", "dell.com/en-us/shop/xps-14-laptop", 9, "19:10:40", None),
    (12, "laptops", "www.lenovo.com", "ThinkPad X1 Carbon Gen 13 | Lenovo US", "lenovo.com/us/en/p/laptops/thinkpad/x1-carbon-gen-13", None, "19:18:02", None),
    (13, "laptops", "www.notebookcheck.net", "Dell XPS 14 vs Apple MacBook Air 15 - Notebookcheck.net", "notebookcheck.net/xps-14-vs-macbook-air-15", None, "20:37:30", None),
    (14, "thesis", "scholar.google.com", "transformer attention interpretability - Google Scholar", "scholar.google.com/scholar?q=transformer+attention+interpretability", None, "16:10:00", None),
    (15, "thesis", "arxiv.org", "Attention is not Explanation", "arxiv.org/abs/1902.10186", 14, "16:10:45", None),
    (16, "thesis", "www.semanticscholar.org", "Analyzing Multi-Head Self-Attention: Specialized Heads Do the Heavy Lifting | Semantic Scholar", "semanticscholar.org/paper/analyzing-multi-head-self-attention", 14, "16:12:30", None),
    (17, "thesis", "www.overleaf.com", "Thesis draft - Chapter 3 Related Work - Overleaf, Online LaTeX Editor", "overleaf.com/project/66a1f0c2", None, "16:40:00", None),
    (18, "thesis", "www.zotero.org", "My Library - Zotero", "zotero.org/mylibrary", None, "16:41:30", None),
    (19, None, "www.youtube.com", "lofi hip hop radio - beats to relax/study to - YouTube", "youtube.com/watch?v=jfKfPfyJRdk", None, "16:05:12", None),
    (20, None, "weather.com", "Lisbon, Portugal 10-Day Weather Forecast - The Weather Channel", "weather.com/weather/tenday/l/Lisbon", None, "16:42:10", None),
])

NEXTJS_K8S_GIFT = ("2026-10-08", "15:30:00", [
    (1, "nextjs", "github.com", "Module not found: Can't resolve 'fs' after upgrading to 15 · Issue #58312 · vercel/next.js · GitHub", "github.com/vercel/next.js/issues/58312", None, "09:02:11", None),
    (2, "nextjs", "www.google.com", "next.js module not found can't resolve 'fs' - Google Search", "google.com/search?q=next.js+module+not+found+can%27t+resolve+fs", None, "09:05:40", "next.js module not found can't resolve 'fs'"),
    (3, "nextjs", "stackoverflow.com", "Module not found: Can't resolve 'fs' in Next.js application - Stack Overflow", "stackoverflow.com/questions/64926174", 2, "09:06:02", None),
    (4, "nextjs", "nextjs.org", "next.config.js: webpack | Next.js", "nextjs.org/docs/app/api-reference/config/next-config-js/webpack", 3, "09:11:30", None),
    (5, "nextjs", "nextjs.org", "Upgrading: Version 15 | Next.js", "nextjs.org/docs/app/guides/upgrading/version-15", None, "09:24:51", None),
    (6, "nextjs", "vercel.com", "Build Logs - tabforest-web - Vercel", "vercel.com/tabforest/tabforest-web/deployments/build-logs", None, "09:31:07", None),
    (7, "nextjs", "www.npmjs.com", "next - npm", "npmjs.com/package/next", None, "09:40:15", None),
    (8, "k8s", "kubernetes.io", "Pods | Kubernetes", "kubernetes.io/docs/concepts/workloads/pods", None, "10:30:00", None),
    (9, "k8s", "kubernetes.io", "Deployments | Kubernetes", "kubernetes.io/docs/concepts/workloads/controllers/deployment", 8, "10:41:22", None),
    (10, "k8s", "www.youtube.com", "Kubernetes Course - Full Beginners Tutorial (Containerize Your Apps!) - YouTube", "youtube.com/watch?v=d6WC5n9G_sM", None, "10:45:10", None),
    (11, "k8s", "www.google.com", "kubectl port-forward vs nodeport service - Google Search", "google.com/search?q=kubectl+port-forward+vs+nodeport+service", None, "11:02:33", "kubectl port-forward vs nodeport service"),
    (12, "k8s", "www.reddit.com", "Best way to actually learn Kubernetes in 2026? : r/kubernetes", "reddit.com/r/kubernetes/comments/1g2h3k4", 11, "11:03:01", None),
    (13, "k8s", "minikube.sigs.k8s.io", "minikube start | minikube", "minikube.sigs.k8s.io/docs/start", None, "11:15:48", None),
    (14, "gift", "www.google.com", "birthday gift ideas for mom who loves gardening - Google Search", "google.com/search?q=birthday+gift+ideas+for+mom+who+loves+gardening", None, "11:16:40", "birthday gift ideas for mom who loves gardening"),
    (15, "gift", "www.etsy.com", "Personalized Garden Tool Set - Etsy", "etsy.com/listing/1290455123/personalized-garden-tool-set", 14, "11:17:05", None),
    (16, "gift", "www.amazon.com", "Amazon.com: Raised Garden Bed Kit, Galvanized", "amazon.com/dp/B08XYZ1234", 14, "11:19:31", None),
    (17, "gift", "www.uncommongoods.com", "Herb Garden Gifts | UncommonGoods", "uncommongoods.com/gifts/herb-garden", None, "13:02:00", None),
    (18, "gift", "www.1800flowers.com", "Same Day Flower Delivery | 1-800-Flowers.com", "1800flowers.com/same-day-flower-delivery", None, "13:05:12", None),
    (19, None, "www.metrodailynews.com", "Transit fares to rise in January - Metro Daily News", "metrodailynews.com/news/transit-fares-january", None, "08:50:02", None),
    (20, None, "www.duolingo.com", "Duolingo - The world's best way to learn a language", "duolingo.com/learn", None, "12:30:44", None),
])

# A burst: 20 tabs from 4 unrelated topics (three of them Wikipedia-style pages), ALL opened within 2.5 minutes and
# interleaved in time, so the temporal bonus would glue them together if it counted without topical similarity.
BURST_UNRELATED = ("2026-10-09", "12:10:00", [
    (1, "rome", "en.wikipedia.org", "Roman Empire - Wikipedia", "en.wikipedia.org/wiki/Roman_Empire", None, "12:00:00", None),
    (2, "photosynthesis", "en.wikipedia.org", "Photosynthesis - Wikipedia", "en.wikipedia.org/wiki/Photosynthesis", None, "12:00:08", None),
    (3, "rust", "doc.rust-lang.org", "Understanding Ownership - The Rust Programming Language", "doc.rust-lang.org/book/ch04-00-understanding-ownership.html", None, "12:00:15", None),
    (4, "sourdough", "en.wikipedia.org", "Sourdough - Wikipedia", "en.wikipedia.org/wiki/Sourdough", None, "12:00:22", None),
    (5, "rome", "en.wikipedia.org", "Julius Caesar - Wikipedia", "en.wikipedia.org/wiki/Julius_Caesar", 1, "12:00:36", None),
    (6, "photosynthesis", "en.wikipedia.org", "Chloroplast - Wikipedia", "en.wikipedia.org/wiki/Chloroplast", 2, "12:00:44", None),
    (7, "rust", "stackoverflow.com", "How does Rust ownership and borrowing work? - Stack Overflow", "stackoverflow.com/questions/24253344", 3, "12:00:51", None),
    (8, "sourdough", "www.kingarthurbaking.com", "Beginner's sourdough starter recipe | King Arthur Baking", "kingarthurbaking.com/recipes/sourdough-starter-recipe", 4, "12:01:05", None),
    (9, "rome", "en.wikipedia.org", "Colosseum - Wikipedia", "en.wikipedia.org/wiki/Colosseum", None, "12:01:12", None),
    (10, "photosynthesis", "www.khanacademy.org", "The Calvin cycle (article) | Khan Academy", "khanacademy.org/science/biology/photosynthesis/calvin-cycle", None, "12:01:19", None),
    (11, "rust", "doc.rust-lang.org", "Lifetimes - Rust By Example", "doc.rust-lang.org/rust-by-example/scope/lifetime.html", None, "12:01:26", None),
    (12, "sourdough", "www.seriouseats.com", "How to feed and maintain a sourdough starter | Serious Eats", "seriouseats.com/how-to-feed-sourdough-starter", None, "12:01:34", None),
    (13, "rome", "www.britannica.com", "Pax Romana | Definition, Dates, & Facts | Britannica", "britannica.com/event/Pax-Romana", 1, "12:01:41", None),
    (14, "photosynthesis", "en.wikipedia.org", "Chlorophyll - Wikipedia", "en.wikipedia.org/wiki/Chlorophyll", 2, "12:01:48", None),
    (15, "rust", "www.google.com", "rust borrow checker cannot borrow as mutable - Google Search", "google.com/search?q=rust+borrow+checker+cannot+borrow+as+mutable", None, "12:01:55", "rust borrow checker cannot borrow as mutable"),
    (16, "sourdough", "www.google.com", "bread flour vs all purpose flour sourdough - Google Search", "google.com/search?q=bread+flour+vs+all+purpose+flour+sourdough", None, "12:02:03", "bread flour vs all purpose flour sourdough"),
    (17, "rome", "en.wikipedia.org", "Roman roads - Wikipedia", "en.wikipedia.org/wiki/Roman_roads", 9, "12:02:10", None),
    (18, "photosynthesis", "www.nature.com", "Light-dependent reactions of photosynthesis in chloroplast thylakoids | Nature Education", "nature.com/scitable/topicpage/photosynthetic-cells-14025371", None, "12:02:18", None),
    (19, "rust", "doc.rust-lang.org", "References and Borrowing - The Rust Programming Language", "doc.rust-lang.org/book/ch04-02-references-and-borrowing.html", 3, "12:02:24", None),
    (20, "sourdough", "www.kingarthurbaking.com", "Sourdough bread baking times and Dutch oven temperatures | King Arthur Baking", "kingarthurbaking.com/blog/sourdough-bread-dutch-oven", 8, "12:02:30", None),
])


def tid(base: int, n: int) -> str:
    return f"00000000-0000-4000-8000-{base + n:012d}"


def build(name: str, spec: tuple, base: int) -> dict:
    day, snap, rows = spec
    tabs, labels = [], {}
    for n, group, domain, title, url, opener, opened, query in rows:
        ref = tid(base, n)
        tabs.append({"tab_ref": ref, "domain": domain, "title": title,
                     "opener_tab_ref": tid(base, opener) if opener else None,
                     "opened_at": f"{day}T{opened}Z", "active": False, "pinned": False,
                     "dup_key": hashlib.sha256(url.encode()).hexdigest(), "search_query": query})
        labels[ref] = group
    tabs.sort(key=lambda t: t["opened_at"])
    return {"about": f"Hand-labeled calibration snapshot '{name}' for R-5 clustering (generated by "
                     "app/engine/scripts/gen_cluster_snapshots.py). labels: null = no group (singleton).",
            "snapshot_at": f"{day}T{snap}Z", "open_tabs": tabs, "labels": labels}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, spec, base in (("trip_laptops_thesis", TRIP_LAPTOPS_THESIS, 100),
                             ("nextjs_k8s_gift", NEXTJS_K8S_GIFT, 200),
                             ("burst_unrelated", BURST_UNRELATED, 300)):
        data = build(name, spec, base)
        (OUT / f"{name}.json").write_bytes((json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
        groups = sorted({g for g in data["labels"].values() if g})
        print(f"wrote {name}.json: {len(data['open_tabs'])} tabs, groups {groups}, "
              f"{sum(g is None for g in data['labels'].values())} singletons")


if __name__ == "__main__":
    main()
