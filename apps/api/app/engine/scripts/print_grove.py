r"""Human-readable summary of a saved grove response (POST /api/grove/grow output).

    .venv\Scripts\python app\engine\scripts\print_grove.py grove.json
"""

import json
import sys


def short(ref: str) -> str:
    return ref[-2:] if ref.startswith("00000000-") else ref[:12]


def claim(c: dict) -> str:
    return f"[{c['provenance']} {c['confidence']:.2f}] {c['display_text']}"


def main(path: str) -> None:
    g = json.loads(open(path, encoding="utf-8").read())
    print(f"run {g['run_id']}  degraded={g['degraded']}  banner={g['banner_text']!r}  hollow_count={g['hollow_count']}")
    for t in g["trees"]:
        print(f"\n== {t['name']}  (fogged={t['fogged']}, canopy={t['canopy']}, attention {t['attention_min']} min, "
              f"{t['days_since_active']} days since active, existing project={t['is_existing_project_id']})")
        print(f"   goal:       {claim(t['goal'])}")
        print(f"   direction:  {claim(t['direction']) if t['direction'] else None}")
        for b in t["branches"]:
            print(f"   branch {b['label']!r} ({b['status']}): "
                  + ", ".join(f"{short(l['tab_ref'])}{'*' if l['fallen'] else ''}:{l['importance']:.2f}" for l in b["leaves"]))
        for s in t["stones"]:
            print(f"   stone ({s['kind']}): {claim(s)}" + (f"  note={s['user_note_id']}" if s["user_note_id"] else ""))
        for m in t["mushrooms"]:
            print(f"   mushroom ({m['kind']}, recurrence {m['recurrence']}): {claim(m)}")
        for a in t["next_actions"]:
            print(f"   next action: {claim(a)}  unblocks={a['unblocks']}")
        for v in t["vines"]:
            print(f"   vine ({v['kind']}): {[short(r) for r in v['tab_refs']]} keep {short(v['keep_ref'])}: {v['reason']}")
        for h in t["hypotheses"]:
            print(f"   hypothesis: {claim(h)}")
        print(f"   important: {[short(r) for r in t['important_tab_refs']]}  shared: {[short(r) for r in t['shared_tab_refs']]}")
    print(f"\nsprouts: {[(s['label'], [short(r) for r in s['tab_refs']]) for s in g['sprouts']]}")
    print(f"meadow:  {[short(r) for r in g['meadow']]}")
    print(f"fog:     {[(short(f['tab_ref']), f['reason']) for f in g['fog']]}")
    print(f"fireflies: {[(f['past_project_name'], f['past_date'], f['similarity'], f['display_text']) for f in g['fireflies']]}")


if __name__ == "__main__":
    main(sys.argv[1])
