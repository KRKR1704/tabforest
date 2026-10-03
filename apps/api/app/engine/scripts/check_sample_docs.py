"""PRE-R2 check for the SAMPLE enterprise documents.

Run from the repo root:
    apps\\api\\.venv\\Scripts\\python apps\\api\\app\\engine\\scripts\\check_sample_docs.py

Exits non-zero if any check fails.
"""

import json
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parents[1] / "fixtures" / "sample_docs"
BANNER = "SAMPLE — fictional data for the TabForest demo. Contoso Ltd. is a fictional company."
MAX_CHARS = 12_000
DECISION_TS = "00:14:32"
DECISION_PHRASE = "we'll go with Functions"
TIMING = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})(?: .*)?$")
VOICE = re.compile(r"^<v [^>]+>")
SESSION_Q = re.compile(r"session (state|storage)", re.IGNORECASE)

failures: list[str] = []


def check(ok: bool, label: str) -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}")
    if not ok:
        failures.append(label)


def seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_vtt(text: str) -> tuple[list[dict], list[str], str]:
    """Return (cues, errors, header_block_text)."""
    errors: list[str] = []
    lines = text.replace("\r\n", "\n").split("\n")
    if not (lines[0] == "WEBVTT" or lines[0].startswith(("WEBVTT ", "WEBVTT\t"))):
        errors.append("first line is not a WEBVTT header")
    blocks = [b for b in "\n".join(lines[1:]).split("\n\n") if b.strip()]
    cues: list[dict] = []
    header_text = ""
    seen_cue = False
    last_start = -1.0
    for block in blocks:
        block_lines = block.strip("\n").split("\n")
        if block_lines[0].startswith("NOTE"):
            if not seen_cue:
                header_text += block + "\n"
            continue
        timing_idx = 0 if "-->" in block_lines[0] else 1
        if timing_idx >= len(block_lines):
            errors.append(f"block without timing line: {block_lines[0][:40]!r}")
            continue
        m = TIMING.match(block_lines[timing_idx])
        if not m:
            errors.append(f"malformed timing line: {block_lines[timing_idx]!r}")
            continue
        start, end = seconds(*m.groups()[:4]), seconds(*m.groups()[4:])
        if end <= start:
            errors.append(f"end <= start: {block_lines[timing_idx]}")
        if start < last_start:
            errors.append(f"cue starts out of order: {block_lines[timing_idx]}")
        last_start = start
        payload = block_lines[timing_idx + 1 :]
        if not payload or any("-->" in line for line in payload):
            errors.append(f"empty or invalid cue payload at {block_lines[timing_idx]}")
        for line in payload:
            if not VOICE.match(line):
                errors.append(f"cue line without voice tag at {block_lines[timing_idx]}")
        seen_cue = True
        cues.append({"timing": block_lines[timing_idx], "start": start, "end": end, "text": "\n".join(payload)})
    return cues, errors, header_text


def walk_quotes(node, path="EXPECTED"):
    if isinstance(node, dict):
        if "quote" in node:
            yield path, node
        for k, v in node.items():
            yield from walk_quotes(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_quotes(v, f"{path}[{i}]")


def main() -> int:
    files = sorted(p for p in DOCS.iterdir() if p.is_file())
    texts = {p.name: p.read_text(encoding="utf-8") for p in files}
    print(f"folder: {DOCS}")
    print(f"files: {len(files)}")

    print("\n== Size and banner")
    vtt_cues, vtt_errors, vtt_header = parse_vtt(texts["teams-transcript.vtt"])
    for name, text in texts.items():
        check(len(text) < MAX_CHARS, f"{name}: {len(text):,} chars < {MAX_CHARS:,}")
        if name.endswith(".vtt"):
            check(BANNER in vtt_header, f"{name}: banner in NOTE block right after WEBVTT header")
        elif name.endswith(".json"):
            data = json.loads(text)
            check(next(iter(data)) == "_banner" and data["_banner"] == BANNER, f"{name}: first key _banner == banner")
        else:
            check(text.startswith(BANNER), f"{name}: starts with banner")

    print("\n== WebVTT")
    first_start = vtt_cues[0]["start"] if vtt_cues else 0
    last_end = vtt_cues[-1]["end"] if vtt_cues else 0
    print(f"cues: {len(vtt_cues)} · span {first_start:.1f}s → {last_end:.1f}s ({(last_end - first_start) / 60:.1f} min)")
    print(f"speakers: {sorted({re.match(r'<v ([^>]+)>', c['text']).group(1) for c in vtt_cues if VOICE.match(c['text'])})}")
    for err in vtt_errors:
        print(f"  parse error: {err}")
    check(not vtt_errors, "teams-transcript.vtt parses (WEBVTT header, well-formed timestamps, voice tags)")
    check(40 <= len(vtt_cues) <= 60, f"cue count {len(vtt_cues)} in 40–60")
    check(20 <= (last_end - first_start) / 60 <= 25, "transcript covers 20–25 minutes")

    decision_cues = [c for c in vtt_cues if c["timing"].startswith(DECISION_TS) and DECISION_PHRASE in c["text"]]
    for c in decision_cues:
        print(f"  {c['timing']}  {c['text']}")
    check(len(decision_cues) == 1, f"'{DECISION_TS}' and \"{DECISION_PHRASE}\" in the same cue")

    session_cues = [c for c in vtt_cues if SESSION_Q.search(c["text"]) and "?" in c["text"]]
    for c in session_cues:
        print(f"  {c['timing']}  {c['text']}")
    speakers = {re.match(r"<v ([^>]+)>", c["text"]).group(1) for c in session_cues}
    check(len(session_cues) == 2, f"cues asking about session state/storage: {len(session_cues)} (must be 2)")
    check(len(speakers) == 2, f"session-state question raised by different people: {sorted(speakers)}")

    print("\n== EXPECTED.json quotes")
    expected = json.loads(texts["EXPECTED.json"])
    quotes = list(walk_quotes(expected))
    for path, item in quotes:
        source = item.get("source")
        ok = source in texts and item["quote"] in texts[source]
        if ok and source.endswith(".vtt") and "timestamp" in item:
            ok = any(c["timing"].startswith(item["timestamp"]) and item["quote"] in c["text"] for c in vtt_cues)
            where = f"{source} @ {item['timestamp']}"
        else:
            where = source
        check(ok, f"{path}: {item['quote']!r} in {where}")
    print(f"quotes checked: {len(quotes)}")

    print(f"\n== Result: {'PASS' if not failures else f'FAIL ({len(failures)} failed)'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
