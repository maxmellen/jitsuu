#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from lxml import html

BASE_URL = "https://kotobank.jp"
XPATH_IMG = '//*[@id="mainArea"]/article/div[2]/h3/span/img'
USER_AGENT = "Mozilla/5.0 (compatible; kotobank-jitsu-scraper/0.1)"
REQUEST_TIMEOUT_SECONDS = 20

KANJI_RE = re.compile(r"[\u4E00-\u9FFF]")
TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect gaiji image sources for kana-only Jitsu entries."
    )
    parser.add_argument(
        "--db",
        default="data/kotobank.sqlite",
        help="SQLite DB path (default: data/kotobank.sqlite)",
    )
    parser.add_argument(
        "--entries-table",
        default="jitsu_entries",
        help="Entries table name (default: jitsu_entries)",
    )
    parser.add_argument(
        "--gaiji-table",
        default="jitsu_gaiji",
        help="Gaiji table name (default: jitsu_gaiji)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max number of entries to process (default: 0 for no limit)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay between requests in seconds (default: 1.0)",
    )
    parser.add_argument(
        "--start-id",
        type=int,
        default=0,
        help="Minimum entry id to process (default: 0)",
    )
    parser.add_argument(
        "--end-id",
        type=int,
        default=0,
        help="Maximum entry id to process (default: 0 for no limit)",
    )
    return parser.parse_args()


def validate_table_name(table: str) -> str:
    if not TABLE_RE.fullmatch(table):
        raise ValueError(
            "Table name must be alphanumeric/underscore and start with a letter or _."
        )
    return table


def ensure_gaiji_schema(conn: sqlite3.Connection, table: str) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table} (
            entry_id INTEGER PRIMARY KEY,
            image_src TEXT NOT NULL,
            gaiji_char TEXT,
            FOREIGN KEY(entry_id) REFERENCES jitsu_entries(id)
        )
        """
    )
    conn.commit()


def is_kana_only(keyword: str) -> bool:
    return not KANJI_RE.search(keyword)


def normalize_image_src(src: str) -> str:
    if src.startswith("http://") or src.startswith("https://"):
        parsed = urlparse(src)
        if parsed.query:
            return f"{parsed.path}?{parsed.query}"
        return parsed.path
    return src


def fetch_image_src(session: requests.Session, href: str) -> str | None:
    url = f"{BASE_URL}{href}"
    response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    doc = html.fromstring(response.text)
    node = doc.xpath(XPATH_IMG)
    if not node:
        return None
    src = node[0].get("src")
    if not src:
        return None
    return normalize_image_src(src)


def upsert_gaiji(
    conn: sqlite3.Connection, table: str, entry_id: int, image_src: str
) -> None:
    conn.execute(
        f"""
        INSERT INTO {table} (entry_id, image_src, gaiji_char)
        VALUES (?, ?, NULL)
        ON CONFLICT(entry_id) DO UPDATE SET
            image_src = excluded.image_src
        """,
        (entry_id, image_src),
    )
    conn.commit()


def main() -> int:
    args = parse_args()
    entries_table = validate_table_name(args.entries_table)
    gaiji_table = validate_table_name(args.gaiji_table)

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 2

    conn = sqlite3.connect(str(db_path))
    ensure_gaiji_schema(conn, gaiji_table)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    sql = (
        f"SELECT id, keyword, href FROM {entries_table} "
        "WHERE type = 'kanji' "
        "AND (? = 0 OR id >= ?) "
        "AND (? = 0 OR id <= ?) "
        "ORDER BY id"
    )
    params = (args.start_id, args.start_id, args.end_id, args.end_id)

    processed = 0
    inserted = 0
    skipped = 0

    for entry_id, keyword, href in conn.execute(sql, params):
        if args.limit and processed >= args.limit:
            break
        if not is_kana_only(keyword):
            continue
        processed += 1
        try:
            image_src = fetch_image_src(session, href)
        except requests.RequestException as exc:
            print(f"[warn] {entry_id} {href}: {exc}", file=sys.stderr)
            skipped += 1
            continue
        if not image_src:
            skipped += 1
            continue
        upsert_gaiji(conn, gaiji_table, entry_id, image_src)
        inserted += 1
        print(f"{entry_id}: {image_src}")
        if args.delay > 0:
            time.sleep(args.delay)

    print(
        "done: "
        f"processed {processed}, inserted {inserted}, skipped {skipped}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
