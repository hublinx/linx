#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
footprint.py — Personal machine auditor (Windows / macOS / Linux)

A transparent tool to scan YOUR OWN computer:
  - history   : browser history -> visited domains + per-visit timeline (when,
                where it was recorded, which browser/profile/DB)
  - search    : deep keyword / regex search across files on disk
  - profiles  : browser profiles, extensions, bookmark counts (no credentials)
  - logs      : discover log files on disk and query Windows Event Logs

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
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

IS_WINDOWS = platform.system() == "Windows"

# --------------------------------------------------------------------------- #
# Browser location discovery
# --------------------------------------------------------------------------- #

def _home() -> Path:
    return Path.home()


def chromium_user_data_dirs() -> dict:
    """Return {browser_name: user_data_dir} for installed Chromium browsers."""
    system = platform.system()
    home = _home()

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
    scan_root = profiles_dir if profiles_dir.exists() else root
    if scan_root.exists():
        for p in scan_root.iterdir():
            if p.is_dir() and (p / "places.sqlite").exists():
                found[f"Firefox/{p.name}"] = p
    return found


def chromium_profiles(user_data_dir: Path) -> list:
    """Return list of profile sub-dir Paths that look like real profiles."""
    profiles = []
    if not user_data_dir.exists():
        return profiles
    for child in sorted(user_data_dir.iterdir()):
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

def chrome_time(micros):
    """Chrome time = microseconds since 1601-01-01 UTC."""
    if not micros:
        return None
    try:
        return datetime.fromtimestamp(micros / 1_000_000 - 11644473600, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def firefox_time(micros):
    """Firefox time = microseconds since 1970-01-01 UTC."""
    if not micros:
        return None
    try:
        return datetime.fromtimestamp(micros / 1_000_000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def iso(dt) -> str:
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S") if dt else ""


def parse_date(s: str):
    """Parse YYYY-MM-DD or YYYY-MM-DD HH:MM into an aware local datetime."""
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).astimezone()
        except ValueError:
            continue
    raise ValueError(f"Bad date '{s}'. Use YYYY-MM-DD or 'YYYY-MM-DD HH:MM'.")


def parse_relative(s: str) -> timedelta:
    """Parse '24h', '7d', '30m' into a timedelta."""
    m = re.fullmatch(r"(\d+)\s*([mhd])", s.strip().lower())
    if not m:
        raise ValueError(f"Bad duration '{s}'. Use e.g. 30m, 24h, 7d.")
    n, unit = int(m.group(1)), m.group(2)
    return {"m": timedelta(minutes=n), "h": timedelta(hours=n), "d": timedelta(days=n)}[unit]


# --------------------------------------------------------------------------- #
# SQLite safe open (DB may be locked by a running browser)
# --------------------------------------------------------------------------- #

def open_locked_db(db_path: Path):
    tmp = Path(tempfile.gettempdir()) / f"footprint_{os.getpid()}_{db_path.name}"
    try:
        shutil.copy2(db_path, tmp)
    except OSError:
        tmp = db_path
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
# HISTORY — per-visit reading
# --------------------------------------------------------------------------- #

def domain_of(url: str) -> str:
    m = re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://([^/\\?#]+)", url or "")
    host = m.group(1) if m else ""
    return host.split("@")[-1].split(":")[0].lower()


def read_chromium_visits(browser: str, profile_dir: Path):
    db = profile_dir / "History"
    if not db.exists():
        return []
    conn, tmp = open_locked_db(db)
    out = []
    try:
        cur = conn.execute(
            "SELECT urls.url AS url, urls.title AS title, visits.visit_time AS vt "
            "FROM visits JOIN urls ON visits.url = urls.id"
        )
        for r in cur:
            out.append({
                "url": r["url"], "title": r["title"] or "",
                "time": chrome_time(r["vt"]),
                "browser": browser, "profile": profile_dir.name, "source": str(db),
                "domain": domain_of(r["url"]),
            })
    except sqlite3.Error as e:
        print(f"  ! {db}: {e}", file=sys.stderr)
    finally:
        conn.close()
        cleanup(tmp)
    return out


def read_firefox_visits(label: str, profile_dir: Path):
    db = profile_dir / "places.sqlite"
    if not db.exists():
        return []
    conn, tmp = open_locked_db(db)
    out = []
    try:
        cur = conn.execute(
            "SELECT p.url AS url, p.title AS title, v.visit_date AS vt "
            "FROM moz_historyvisits v JOIN moz_places p ON v.place_id = p.id"
        )
        for r in cur:
            out.append({
                "url": r["url"], "title": r["title"] or "",
                "time": firefox_time(r["vt"]),
                "browser": "Firefox", "profile": label, "source": str(db),
                "domain": domain_of(r["url"]),
            })
    except sqlite3.Error as e:
        print(f"  ! {db}: {e}", file=sys.stderr)
    finally:
        conn.close()
        cleanup(tmp)
    return out


def collect_visits():
    visits = []
    for browser, udd in chromium_user_data_dirs().items():
        for prof in chromium_profiles(udd):
            visits.extend(read_chromium_visits(browser, prof))
    for label, prof in firefox_profile_dirs().items():
        visits.extend(read_firefox_visits(label, prof))
    return visits


def cmd_history(args):
    since = parse_date(args.since) if args.since else None
    until = parse_date(args.until) if args.until else None
    visits = collect_visits()

    def in_range(v):
        t = v["time"]
        if t is None:
            return since is None and until is None
        t = t.astimezone()
        return (since is None or t >= since) and (until is None or t <= until)

    visits = [v for v in visits if in_range(v)]
    if args.domain:
        needle = args.domain.lower()
        visits = [v for v in visits if needle in v["domain"]]

    if not visits:
        print("No matching browser history found.")
        return

    if args.timeline or args.domain:
        # Per-visit timeline: when, where recorded, which browser/profile
        visits.sort(key=lambda v: (v["time"] or datetime.min.replace(tzinfo=timezone.utc)))
        shown = visits[-args.top:] if args.top else visits
        print(f"{'WHEN':<19}  {'BROWSER / PROFILE':<22}  URL")
        print("-" * 90)
        for v in shown:
            src = f"{v['browser']}/{v['profile']}"
            print(f"{iso(v['time']):<19}  {src:<22}  {v['url'][:70]}")
        print(f"\n{len(visits)} visit(s). Recorded in:")
        for src in sorted({v["source"] for v in visits}):
            print(f"  - {src}")
    else:
        # Default: aggregate by domain
        agg = {}
        for v in visits:
            d = v["domain"]
            if not d:
                continue
            a = agg.setdefault(d, {"domain": d, "visits": 0, "first": None, "last": None})
            a["visits"] += 1
            t = v["time"]
            if t:
                if a["first"] is None or t < a["first"]:
                    a["first"] = t
                if a["last"] is None or t > a["last"]:
                    a["last"] = t
        ranked = sorted(agg.values(), key=lambda x: x["visits"], reverse=True)
        if args.top:
            ranked = ranked[: args.top]
        print(f"{'VISITS':>7}  {'FIRST':<19}  {'LAST':<19}  DOMAIN")
        print("-" * 80)
        for d in ranked:
            print(f"{d['visits']:>7}  {iso(d['first']):<19}  {iso(d['last']):<19}  {d['domain']}")
        print(f"\nTotal unique domains: {len(agg)}")

    if args.out:
        export_history(args.out, visits)


def export_history(out_path: str, visits: list):
    path = Path(out_path)
    ext = path.suffix.lower()
    rows = [{
        "time": iso(v["time"]), "domain": v["domain"], "url": v["url"],
        "title": v["title"], "browser": v["browser"], "profile": v["profile"],
        "source": v["source"],
    } for v in sorted(visits, key=lambda v: (v["time"] or datetime.min.replace(tzinfo=timezone.utc)))]
    if ext == ".json":
        path.write_text(json.dumps(
            {"generated": datetime.now().astimezone().isoformat(), "visits": rows},
            ensure_ascii=False, indent=2), encoding="utf-8")
    elif ext == ".csv":
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["time", "domain", "url", "title", "browser", "profile", "source"])
            w.writeheader()
            w.writerows(rows)
    elif ext in (".html", ".htm"):
        _history_html(path, rows)
    else:
        print(f"Unknown export extension '{ext}'. Use .csv/.json/.html", file=sys.stderr)
        return
    print(f"Exported -> {path.resolve()}")


def _history_html(path: Path, rows: list):
    def esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    body = "\n".join(
        f"<tr><td>{esc(r['time'])}</td><td>{esc(r['domain'])}</td>"
        f"<td>{esc(r['browser'])}/{esc(r['profile'])}</td>"
        f"<td><a href='{esc(r['url'])}'>{esc(r['url'][:90])}</a></td></tr>"
        for r in rows)
    path.write_text(f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Browser history timeline</title>
<style>body{{font:13px system-ui,sans-serif;margin:1.5rem;background:#0f172a;color:#e2e8f0}}
table{{border-collapse:collapse;width:100%}}th,td{{padding:5px 9px;border-bottom:1px solid #334155;text-align:left;vertical-align:top}}
th{{position:sticky;top:0;background:#1e293b}}tr:hover{{background:#1e293b}}a{{color:#60a5fa}}</style></head><body>
<h1>Browser history timeline</h1><p>{len(rows)} visits · generated {esc(datetime.now().astimezone().strftime('%Y-%m-%d %H:%M'))}</p>
<table><thead><tr><th>When</th><th>Domain</th><th>Source</th><th>URL</th></tr></thead>
<tbody>{body}</tbody></table></body></html>""", encoding="utf-8")


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
    ".bat", ".ps1", ".env", ".toml", ".rst", ".reg",
}


def looks_binary(chunk: bytes) -> bool:
    if b"\x00" in chunk:
        return True
    textset = bytes(range(32, 127)) + b"\n\r\t\f\b"
    nontext = sum(b not in textset for b in chunk)
    return len(chunk) > 0 and nontext / len(chunk) > 0.30


def iter_files(root: Path, exts, max_mb: float, follow_hidden: bool):
    limit = int(max_mb * 1024 * 1024)
    for dirpath, dirnames, filenames in os.walk(root):
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

    total_hits = files_hit = 0
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
                print(f"\n{fp}")
                for lineno, snippet in matches:
                    print(f"  {lineno}: {snippet}")

    print(f"\n{files_hit} file(s), {total_hits} match(es).")
    if args.out:
        Path(args.out).write_text(json.dumps(
            {"keyword": args.keyword, "root": str(root), "results": results},
            ensure_ascii=False, indent=2), encoding="utf-8")
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
                mn = m.get("name", ext_id.name)
                name = ext_id.name if isinstance(mn, str) and mn.startswith("__MSG_") else mn
            except (OSError, json.JSONDecodeError):
                pass
        names.append(name)
    return names


def profile_display_name(udd: Path, profile_name: str) -> str:
    local_state = udd / "Local State"
    if local_state.exists():
        try:
            ls = json.loads(local_state.read_text(encoding="utf-8"))
            return ls.get("profile", {}).get("info_cache", {}).get(profile_name, {}).get("name", profile_name)
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
            print(f"\n{browser} — {display}  ({prof.name})")
            print(f"  path       : {prof}")
            print(f"  bookmarks  : {count_bookmarks(prof)}")
            print(f"  extensions : {len(exts)}")
            if args.verbose and exts:
                for name in sorted(exts):
                    print(f"      - {name}")
    for label, prof in firefox_profile_dirs().items():
        found_any = True
        print(f"\nFirefox — {label}\n  path       : {prof}")
    if not found_any:
        print("No browser profiles found for the current user.")


# --------------------------------------------------------------------------- #
# LOGS command — discover log files + query Windows Event Log
# --------------------------------------------------------------------------- #

def log_search_roots() -> list:
    home = _home()
    if IS_WINDOWS:
        sysroot = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        return [
            sysroot / "System32" / "winevt" / "Logs",   # .evtx event logs
            sysroot / "Logs",
            sysroot / "Panther",                         # setup logs
            Path(os.environ.get("ProgramData", r"C:\ProgramData")),
            Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local")),
            home,
        ]
    elif platform.system() == "Darwin":
        return [Path("/var/log"), home / "Library" / "Logs", Path("/Library/Logs")]
    else:
        return [Path("/var/log"), home / ".local" / "state", home / ".cache"]


LOG_PATTERNS = (".log", ".evtx", ".etl", ".txt")


def cmd_logs(args):
    if args.events is not None:
        return query_windows_events(args)

    # Discover log files
    exts = {".log", ".evtx", ".etl"}
    if args.include_txt:
        exts.add(".txt")
    newer_than = None
    if args.since:
        newer_than = parse_date(args.since)

    print("Scanning for log files...\n")
    found = []
    for root in log_search_roots():
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            depth = Path(dirpath).relative_to(root).parts
            if len(depth) > args.depth:
                dirnames[:] = []
                continue
            for fn in filenames:
                if Path(fn).suffix.lower() not in exts:
                    continue
                fp = Path(dirpath) / fn
                try:
                    st = fp.stat()
                except OSError:
                    continue
                mtime = datetime.fromtimestamp(st.st_mtime).astimezone()
                if newer_than and mtime < newer_than:
                    continue
                found.append((mtime, st.st_size, fp))

    found.sort(reverse=True)
    if args.top:
        found = found[: args.top]
    print(f"{'MODIFIED':<19}  {'SIZE':>10}  PATH")
    print("-" * 80)
    for mtime, size, fp in found:
        print(f"{iso(mtime):<19}  {size:>10,}  {fp}")
    print(f"\n{len(found)} log file(s). Tip: 'footprint search <keyword> <path>' to look inside .log/.txt files.")
    if IS_WINDOWS:
        print("For .evtx (Windows Event Log), use:  footprint logs --events System --last 24h")


def query_windows_events(args):
    if not IS_WINDOWS:
        print("Windows Event Log query is only available on Windows.", file=sys.stderr)
        sys.exit(1)

    channel = args.events
    start = None
    if args.last:
        start = datetime.now().astimezone() - parse_relative(args.last)
    elif args.since:
        start = parse_date(args.since)

    # Build a PowerShell Get-WinEvent query returning JSON.
    filt = f"@{{LogName='{channel}'}}"
    ps = (
        f"$ErrorActionPreference='Stop';"
        f"$e = Get-WinEvent -FilterHashtable {filt} -MaxEvents {args.max} 2>$null;"
    )
    if start:
        iso_start = start.strftime("%Y-%m-%dT%H:%M:%S")
        ps = (
            f"$ErrorActionPreference='Stop';"
            f"$e = Get-WinEvent -FilterHashtable @{{LogName='{channel}';StartTime=[datetime]'{iso_start}'}} "
            f"-MaxEvents {args.max} 2>$null;"
        )
    ps += (
        "$e | Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,"
        "@{n='Message';e={($_.Message -split \"`n\")[0]}} | ConvertTo-Json -Depth 3 -Compress"
    )

    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, text=True, timeout=120,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f"Could not run PowerShell: {e}", file=sys.stderr)
        sys.exit(1)

    out = (proc.stdout or "").strip()
    if not out:
        err = (proc.stderr or "").strip()
        print(f"No events (channel '{channel}' may need Administrator, or is empty).")
        if err:
            print(f"  {err.splitlines()[0]}", file=sys.stderr)
        return
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        print(out)
        return
    if isinstance(data, dict):
        data = [data]

    print(f"{'WHEN':<19}  {'ID':>6}  {'LEVEL':<12}  PROVIDER / MESSAGE")
    print("-" * 90)
    for ev in data:
        t = ev.get("TimeCreated", "")
        # .NET JSON date -> keep readable portion
        m = re.search(r"(\d+)", str(t))
        when = ""
        if m and "Date(" in str(t):
            when = iso(datetime.fromtimestamp(int(m.group(1)) / 1000).astimezone())
        else:
            when = str(t)[:19].replace("T", " ")
        prov = ev.get("ProviderName", "")
        msg = (ev.get("Message") or "").strip()[:60]
        print(f"{when:<19}  {str(ev.get('Id','')):>6}  {str(ev.get('LevelDisplayName','')):<12}  {prov}: {msg}")
    print(f"\n{len(data)} event(s) from '{channel}'.")
    if args.out:
        Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Exported -> {Path(args.out).resolve()}")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser():
    p = argparse.ArgumentParser(
        prog="footprint",
        description="Audit your own computer. Does NOT read or decrypt saved passwords or cookies.",
    )
    sub = p.add_subparsers(dest="command", required=True)

    h = sub.add_parser("history", help="Visited domains + per-visit timeline")
    h.add_argument("--domain", help="Show every visit to domains matching this text (timeline)")
    h.add_argument("--timeline", action="store_true", help="Show per-visit timeline instead of domain summary")
    h.add_argument("--since", metavar="DATE", help="Only visits on/after YYYY-MM-DD[ HH:MM]")
    h.add_argument("--until", metavar="DATE", help="Only visits on/before YYYY-MM-DD[ HH:MM]")
    h.add_argument("--top", type=int, default=100, help="Limit rows (default 100; 0 = all)")
    h.add_argument("--out", metavar="FILE", help="Export visits to .csv/.json/.html")
    h.set_defaults(func=cmd_history)

    s = sub.add_parser("search", help="Deep keyword / regex search across files")
    s.add_argument("keyword", help="Keyword, or regex with --regex")
    s.add_argument("path", nargs="?", default=str(Path.home()), help="Root path (default: home)")
    s.add_argument("--regex", action="store_true")
    s.add_argument("--case-sensitive", action="store_true")
    s.add_argument("--ext", nargs="+", metavar="EXT", help="Only these extensions, e.g. --ext txt log")
    s.add_argument("--all-types", action="store_true", help="Scan all non-binary files")
    s.add_argument("--max-mb", type=float, default=20, help="Skip files bigger than this (MB)")
    s.add_argument("--max-per-file", type=int, default=20)
    s.add_argument("--hidden", action="store_true", help="Include hidden/dot files and dirs")
    s.add_argument("--quiet", action="store_true")
    s.add_argument("--out", metavar="FILE", help="Export results to JSON")
    s.set_defaults(func=cmd_search)

    pr = sub.add_parser("profiles", help="Browser profiles, extensions, bookmark counts")
    pr.add_argument("--verbose", "-v", action="store_true", help="List extension names")
    pr.set_defaults(func=cmd_profiles)

    lg = sub.add_parser("logs", help="Find log files on disk, or query Windows Event Log")
    lg.add_argument("--events", metavar="CHANNEL", nargs="?", const="System", default=None,
                    help="Query a Windows Event Log channel (e.g. System, Application, Security)")
    lg.add_argument("--last", metavar="DUR", help="For --events: events in the last 30m/24h/7d")
    lg.add_argument("--since", metavar="DATE", help="Only entries on/after YYYY-MM-DD[ HH:MM]")
    lg.add_argument("--max", type=int, default=200, help="For --events: max events (default 200)")
    lg.add_argument("--depth", type=int, default=4, help="Directory recursion depth for file scan")
    lg.add_argument("--include-txt", action="store_true", help="Also list .txt files when scanning")
    lg.add_argument("--top", type=int, default=100, help="Limit rows (default 100; 0 = all)")
    lg.add_argument("--out", metavar="FILE", help="For --events: export to JSON")
    lg.set_defaults(func=cmd_logs)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
