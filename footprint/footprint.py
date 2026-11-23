#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
footprint.py — Personal digital-footprint auditor (Windows / macOS / Linux)

A transparent tool for auditing YOUR OWN machine:
  - history   : read browser history -> visited domains, counts, timeline
  - search    : deep keyword / regex search across files on disk
  - profiles  : list browser profiles, extensions, bookmark counts (no credentials)

It does NOT read, decrypt, or export saved passwords or cookies. For your own
saved passwords use your browser's built-in, authenticated export instead.

Standard library only. Run:  python footprint.py <command> --help
"""

import argparse
import csv
import json
import os
import platform
import re
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# Browser location discovery
# --------------------------------------------------------------------------- #

def _home() -> Path:
    return Path.home()


def chromium_user_data_dirs() -> dict:
    """Return {browser_name: user_data_dir} for installed Chromium browsers."""
    system = platform.system()
    home = _home()
    candidates: dict = {}

    if system == "Windows":
        local = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        roaming = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        candidates = {
            "Chrome": local / "Google" / "Chrome" / "User Data",
            "Chrome Beta": local / "Google" / "Chrome Beta" / "User Data",
            "Edge": local / "Microsoft" / "Edge" / "User Data",
            "Brave": local / "BraveSoftware" / "Brave-Browser" / "User Data",
            "Vivaldi": local / "Vivaldi" / "User Data",
            "Opera": roaming / "Opera Software" / "Opera Stable",
            "Opera GX": roaming / "Opera Software" / "Opera GX Stable",
        }
    elif system == "Darwin":
        app = home / "Library" / "Application Support"
        candidates = {
            "Chrome": app / "Google" / "Chrome",
            "Edge": app / "Microsoft Edge",
            "Brave": app / "BraveSoftware" / "Brave-Browser",
            "Vivaldi": app / "Vivaldi",
        }
    else:  # Linux
        cfg = home / ".config"
        candidates = {
            "Chrome": cfg / "google-chrome",
            "Chromium": cfg / "chromium",
            "Edge": cfg / "microsoft-edge",
            "Brave": cfg / "BraveSoftware" / "Brave-Browser",
            "Vivaldi": cfg / "vivaldi",
        }

    return {name: p for name, p in candidates.items() if p.exists()}


def firefox_profile_dirs() -> dict:
    """Return {profile_label: profile_dir} for Firefox profiles."""
    system = platform.system()
    home = _home()
    if system == "Windows":
        root = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming")) / "Mozilla" / "Firefox"
    elif system == "Darwin":
        root = home / "Library" / "Application Support" / "Firefox"
    else:
        root = home / ".mozilla" / "firefox"

    profiles_dir = root / "Profiles"
    found: dict = {}
    if profiles_dir.exists():
        for p in profiles_dir.iterdir():
            if p.is_dir() and (p / "places.sqlite").exists():
                found[f"Firefox/{p.name}"] = p
    elif root.exists():
        # Some installs keep profiles directly under the root
        for p in root.iterdir():
            if p.is_dir() and (p / "places.sqlite").exists():
                found[f"Firefox/{p.name}"] = p
    return found


def chromium_profiles(user_data_dir: Path) -> list:
    """Return list of profile sub-dir Paths that contain a History DB."""
    profiles = []
    for child in sorted(user_data_dir.iterdir()) if user_data_dir.exists() else []:
        if not child.is_dir():
            continue
        name = child.name
        if name == "Default" or name.startswith("Profile ") or name == "Guest Profile":
            if (child / "History").exists() or (child / "Preferences").exists():
                profiles.append(child)
    return profiles


# --------------------------------------------------------------------------- #
# Timestamp helpers
# --------------------------------------------------------------------------- #

def chrome_time(micros: int):
    """Chrome time = microseconds since 1601-01-01 UTC."""
    if not micros:
        return None
    try:
        # 11644473600 seconds between 1601 and 1970
        return datetime.fromtimestamp(micros / 1_000_000 - 11644473600, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def firefox_time(micros: int):
    """Firefox time = microseconds since 1970-01-01 UTC."""
    if not micros:
        return None
    try:
        return datetime.fromtimestamp(micros / 1_000_000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def iso(dt) -> str:
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S") if dt else ""


# --------------------------------------------------------------------------- #
# SQLite safe open (DB may be locked by a running browser)
# --------------------------------------------------------------------------- #

def open_locked_db(db_path: Path):
    """Copy the DB to a temp file so we can read it even while the browser runs."""
    tmp = Path(tempfile.gettempdir()) / f"footprint_{os.getpid()}_{db_path.name}"
    try:
        shutil.copy2(db_path, tmp)
    except OSError:
        tmp = db_path  # fall back to direct (read-only) open
    conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn, (tmp if tmp != db_path else None)


def cleanup(tmp):
    if tmp:
        try:
            Path(tmp).unlink()
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# HISTORY command
# --------------------------------------------------------------------------- #

def domain_of(url: str) -> str:
    m = re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://([^/\\?#]+)", url or "")
    host = m.group(1) if m else ""
    host = host.split("@")[-1].split(":")[0].lower()  # strip user-info and port
    return host


def read_chromium_history(profile_dir: Path):
    db = profile_dir / "History"
    if not db.exists():
        return []
    conn, tmp = open_locked_db(db)
    rows = []
    try:
        cur = conn.execute(
            "SELECT urls.url, urls.title, urls.visit_count, "
            "       (SELECT MAX(visit_time) FROM visits WHERE visits.url = urls.id) AS last_visit "
            "FROM urls ORDER BY urls.visit_count DESC"
        )
        for r in cur:
            rows.append({
                "url": r["url"],
                "title": r["title"] or "",
                "visit_count": r["visit_count"] or 0,
                "last_visit": chrome_time(r["last_visit"]),
            })
    except sqlite3.Error as e:
        print(f"  ! could not read {db}: {e}", file=sys.stderr)
    finally:
        conn.close()
        cleanup(tmp)
    return rows


def read_firefox_history(profile_dir: Path):
    db = profile_dir / "places.sqlite"
    if not db.exists():
        return []
    conn, tmp = open_locked_db(db)
    rows = []
    try:
        cur = conn.execute(
            "SELECT url, title, visit_count, last_visit_date "
            "FROM moz_places WHERE visit_count > 0 ORDER BY visit_count DESC"
        )
        for r in cur:
            rows.append({
                "url": r["url"],
                "title": r["title"] or "",
                "visit_count": r["visit_count"] or 0,
                "last_visit": firefox_time(r["last_visit_date"]),
            })
    except sqlite3.Error as e:
        print(f"  ! could not read {db}: {e}", file=sys.stderr)
    finally:
        conn.close()
        cleanup(tmp)
    return rows


def collect_history():
    """Return list of (browser, profile_label, rows)."""
    out = []
    for browser, udd in chromium_user_data_dirs().items():
        for prof in chromium_profiles(udd):
            rows = read_chromium_history(prof)
            if rows:
                out.append((browser, prof.name, rows))
    for label, prof in firefox_profile_dirs().items():
        rows = read_firefox_history(prof)
        if rows:
            out.append(("Firefox", label, rows))
    return out


def cmd_history(args):
    data = collect_history()
    if not data:
        print("No browser history found for the current user.")
        return

    # Aggregate by domain
    domains: dict = {}
    all_rows = []
    for browser, prof, rows in data:
        for r in rows:
            r2 = dict(r, browser=browser, profile=prof, domain=domain_of(r["url"]))
            all_rows.append(r2)
            d = r2["domain"]
            if not d:
                continue
            agg = domains.setdefault(d, {"domain": d, "visits": 0, "last_visit": None})
            agg["visits"] += r2["visit_count"]
            if r2["last_visit"] and (agg["last_visit"] is None or r2["last_visit"] > agg["last_visit"]):
                agg["last_visit"] = r2["last_visit"]

    ranked = sorted(domains.values(), key=lambda x: x["visits"], reverse=True)
    if args.top:
        ranked = ranked[: args.top]

    if args.format == "domains":
        print(f"{'VISITS':>8}  {'LAST VISIT':<19}  DOMAIN")
        print("-" * 60)
        for d in ranked:
            print(f"{d['visits']:>8}  {iso(d['last_visit']):<19}  {d['domain']}")
        print(f"\nTotal unique domains: {len(domains)}")

    if args.out:
        export_rows(args.out, args.format, ranked, all_rows)


def export_rows(out_path: str, fmt: str, ranked: list, all_rows: list):
    path = Path(out_path)
    ext = path.suffix.lower()
    if ext == ".json":
        payload = {
            "generated": datetime.now().astimezone().isoformat(),
            "domains": [{**d, "last_visit": iso(d["last_visit"])} for d in ranked],
            "urls": [{**r, "last_visit": iso(r["last_visit"])} for r in all_rows],
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    elif ext == ".csv":
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["domain", "visits", "last_visit"])
            for d in ranked:
                w.writerow([d["domain"], d["visits"], iso(d["last_visit"])])
    elif ext in (".html", ".htm"):
        _export_html(path, ranked, all_rows)
    else:
        print(f"Unknown export extension '{ext}'. Use .csv, .json, or .html", file=sys.stderr)
        return
    print(f"Exported -> {path.resolve()}")


def _export_html(path: Path, ranked: list, all_rows: list):
    def esc(s):
        return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    rows_html = "\n".join(
        f"<tr><td>{esc(d['domain'])}</td><td>{d['visits']}</td><td>{esc(iso(d['last_visit']))}</td></tr>"
        for d in ranked
    )
    html = f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Digital footprint — domains</title>
<style>body{{font:14px system-ui,sans-serif;margin:2rem;background:#0f172a;color:#e2e8f0}}
table{{border-collapse:collapse;width:100%}}th,td{{padding:6px 10px;border-bottom:1px solid #334155;text-align:left}}
th{{position:sticky;top:0;background:#1e293b}}tr:hover{{background:#1e293b}}h1{{font-size:18px}}
.meta{{color:#94a3b8;margin-bottom:1rem}}</style></head><body>
<h1>Visited domains</h1>
<div class="meta">Generated {esc(datetime.now().astimezone().strftime('%Y-%m-%d %H:%M'))} · {len(ranked)} domains · {len(all_rows)} URLs</div>
<table><thead><tr><th>Domain</th><th>Visits</th><th>Last visit</th></tr></thead>
<tbody>{rows_html}</tbody></table></body></html>"""
    path.write_text(html, encoding="utf-8")


# --------------------------------------------------------------------------- #
# SEARCH command
# --------------------------------------------------------------------------- #

DEFAULT_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "$Recycle.Bin",
    "AppData", "Windows", "Program Files", "Program Files (x86)", "ProgramData",
}
TEXT_EXT = {
    ".txt", ".md", ".log", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml",
    ".ini", ".cfg", ".conf", ".py", ".js", ".ts", ".java", ".c", ".cpp", ".h",
    ".cs", ".go", ".rs", ".rb", ".php", ".html", ".htm", ".css", ".sql", ".sh",
    ".bat", ".ps1", ".env", ".toml", ".rst",
}


def looks_binary(chunk: bytes) -> bool:
    if b"\x00" in chunk:
        return True
    # high ratio of non-text bytes
    text_bytes = bytes(range(32, 127)) + b"\n\r\t\f\b"
    nontext = sum(b not in text_bytes for b in chunk)
    return len(chunk) > 0 and nontext / len(chunk) > 0.30


def iter_files(root: Path, exts, max_mb: float, follow_hidden: bool):
    limit = int(max_mb * 1024 * 1024)
    for dirpath, dirnames, filenames in os.walk(root):
        # prune skip dirs in place
        dirnames[:] = [
            d for d in dirnames
            if d not in DEFAULT_SKIP_DIRS and (follow_hidden or not d.startswith("."))
        ]
        for fn in filenames:
            if not follow_hidden and fn.startswith("."):
                continue
            fp = Path(dirpath) / fn
            if exts and fp.suffix.lower() not in exts:
                continue
            try:
                if fp.stat().st_size > limit:
                    continue
            except OSError:
                continue
            yield fp


def cmd_search(args):
    root = Path(args.path).expanduser()
    if not root.exists():
        print(f"Path not found: {root}", file=sys.stderr)
        sys.exit(1)

    flags = 0 if args.case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(args.keyword if args.regex else re.escape(args.keyword), flags)
    except re.error as e:
        print(f"Bad regex: {e}", file=sys.stderr)
        sys.exit(1)

    exts = None
    if args.ext:
        exts = {e if e.startswith(".") else "." + e for e in (x.lower() for x in args.ext)}
    elif not args.all_types:
        exts = TEXT_EXT

    total_hits = 0
    files_hit = 0
    results = []
    for fp in iter_files(root, exts, args.max_mb, args.hidden):
        try:
            with fp.open("rb") as f:
                head = f.read(4096)
                if looks_binary(head):
                    continue
                f.seek(0)
                raw = f.read()
        except OSError:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1", errors="replace")

        matches = []
        for lineno, line in enumerate(text.splitlines(), 1):
            if pattern.search(line):
                matches.append((lineno, line.strip()[:300]))
                if len(matches) >= args.max_per_file:
                    break
        if matches:
            files_hit += 1
            total_hits += len(matches)
            results.append({"file": str(fp), "matches": matches})
            if not args.quiet:
                print(f"\n\033[1m{fp}\033[0m" if sys.stdout.isatty() else f"\n{fp}")
                for lineno, snippet in matches:
                    print(f"  {lineno}: {snippet}")

    print(f"\n{files_hit} file(s), {total_hits} match(es).")
    if args.out:
        Path(args.out).write_text(
            json.dumps({"keyword": args.keyword, "root": str(root), "results": results},
                       ensure_ascii=False, indent=2),
            encoding="utf-8")
        print(f"Exported -> {Path(args.out).resolve()}")


# --------------------------------------------------------------------------- #
# PROFILES command
# --------------------------------------------------------------------------- #

def count_bookmarks(profile_dir: Path) -> int:
    bm = profile_dir / "Bookmarks"
    if not bm.exists():
        return 0
    try:
        data = json.loads(bm.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0
    n = 0

    def walk(node):
        nonlocal n
        if isinstance(node, dict):
            if node.get("type") == "url":
                n += 1
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(data.get("roots", {}))
    return n


def list_extensions(profile_dir: Path) -> list:
    ext_dir = profile_dir / "Extensions"
    names = []
    if not ext_dir.exists():
        return names
    for ext_id in ext_dir.iterdir():
        if not ext_id.is_dir():
            continue
        versions = [v for v in ext_id.iterdir() if v.is_dir()]
        if not versions:
            continue
        manifest = sorted(versions)[-1] / "manifest.json"
        name = ext_id.name
        if manifest.exists():
            try:
                m = json.loads(manifest.read_text(encoding="utf-8"))
                name = m.get("name", ext_id.name)
                if isinstance(name, str) and name.startswith("__MSG_"):
                    name = ext_id.name  # localized; skip resolving
            except (OSError, json.JSONDecodeError):
                pass
        names.append(name)
    return names


def profile_display_name(udd: Path, profile_name: str) -> str:
    local_state = udd / "Local State"
    if local_state.exists():
        try:
            ls = json.loads(local_state.read_text(encoding="utf-8"))
            info = ls.get("profile", {}).get("info_cache", {}).get(profile_name, {})
            return info.get("name", profile_name)
        except (OSError, json.JSONDecodeError):
            pass
    return profile_name


def cmd_profiles(args):
    found_any = False
    for browser, udd in chromium_user_data_dirs().items():
        for prof in chromium_profiles(udd):
            found_any = True
            display = profile_display_name(udd, prof.name)
            exts = list_extensions(prof)
            bms = count_bookmarks(prof)
            print(f"\n\033[1m{browser}\033[0m — {display}  ({prof.name})" if sys.stdout.isatty()
                  else f"\n{browser} — {display}  ({prof.name})")
            print(f"  path       : {prof}")
            print(f"  bookmarks  : {bms}")
            print(f"  extensions : {len(exts)}")
            if args.verbose and exts:
                for name in sorted(exts):
                    print(f"      - {name}")

    for label, prof in firefox_profile_dirs().items():
        found_any = True
        print(f"\nFirefox — {label}")
        print(f"  path       : {prof}")

    if not found_any:
        print("No browser profiles found for the current user.")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser():
    p = argparse.ArgumentParser(
        prog="footprint",
        description="Personal digital-footprint auditor for your own machine. "
                    "Does NOT read or decrypt saved passwords or cookies.",
    )
    sub = p.add_subparsers(dest="command", required=True)

    h = sub.add_parser("history", help="Visited domains / browser history")
    h.add_argument("--top", type=int, default=50, help="Show top N domains (default 50)")
    h.add_argument("--format", choices=["domains"], default="domains")
    h.add_argument("--out", metavar="FILE", help="Export to .csv / .json / .html")
    h.set_defaults(func=cmd_history)

    s = sub.add_parser("search", help="Deep keyword / regex search across files")
    s.add_argument("keyword", help="Keyword, or regex with --regex")
    s.add_argument("path", nargs="?", default=str(Path.home()), help="Root path (default: home)")
    s.add_argument("--regex", action="store_true", help="Treat keyword as a regex")
    s.add_argument("--case-sensitive", action="store_true")
    s.add_argument("--ext", nargs="+", metavar="EXT", help="Only these extensions, e.g. --ext txt log")
    s.add_argument("--all-types", action="store_true", help="Scan all non-binary files, not just common text types")
    s.add_argument("--max-mb", type=float, default=20, help="Skip files bigger than this (MB, default 20)")
    s.add_argument("--max-per-file", type=int, default=20, help="Max matches per file (default 20)")
    s.add_argument("--hidden", action="store_true", help="Include hidden/dot files and dirs")
    s.add_argument("--quiet", action="store_true", help="Only print the summary")
    s.add_argument("--out", metavar="FILE", help="Export results to a JSON file")
    s.set_defaults(func=cmd_search)

    pr = sub.add_parser("profiles", help="List browser profiles, extensions, bookmark counts")
    pr.add_argument("--verbose", "-v", action="store_true", help="List extension names")
    pr.set_defaults(func=cmd_profiles)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
