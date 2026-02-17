#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import time
from pathlib import Path

import requests
from lxml import html

BASE_URL = "https://kotobank.jp/dictionary/jitsu/{page}/"
XPATH = "//*[@id=\"mainArea\"]/section/ul//a"
USER_AGENT = "Mozilla/5.0 (compatible; kotobank-jitsu-scraper/0.1)"
REQUEST_TIMEOUT_SECONDS = 20

KANJI_SUFFIX_RE = re.compile(r"\s*\(漢字\)\s*$")
ID_RE = re.compile(r"-([0-9]+)(?:#|$)")
TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape Kotobank Jitsu keyword lists into SQLite."
    )
    parser.add_argument("--start", type=int, default=1, help="Start page (inclusive)")
    parser.add_argument("--end", type=int, default=104, help="End page (inclusive)")
    parser.add_argument(
        "--db",
        default="data/kotobank.sqlite",
        help="SQLite DB path (default: data/kotobank.sqlite)",
    )
    parser.add_argument(
        "--table",
        default="jitsu_entries",
        help="SQLite table name (default: jitsu_entries)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay between requests in seconds (default: 1.0)",
    )
    return parser.parse_args()


def validate_table_name(table: str) -> str:
    if not TABLE_RE.fullmatch(table):
        raise ValueError(
            "Table name must be alphanumeric/underscore and start with a letter or _."
        )
    return table


def ensure_schema(conn: sqlite3.Connection, table: str) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table} (
            id INTEGER PRIMARY KEY,
            keyword TEXT NOT NULL,
            href TEXT NOT NULL
        )
        """
    )
    conn.commit()


def extract_entries(doc: html.HtmlElement) -> list[tuple[int, str, str]]:
    entries: list[tuple[int, str, str]] = []
    for anchor in doc.xpath(XPATH):
        keyword_raw = anchor.text_content().strip()
        if not keyword_raw:
            continue
        keyword = KANJI_SUFFIX_RE.sub("", keyword_raw).strip()
        if not keyword:
            continue
        href = anchor.get("href")
        if not href:
            continue
        match = ID_RE.search(href)
        if not match:
            continue
        entry_id = int(match.group(1))
        entries.append((entry_id, keyword, href))
    return entries


def upsert_entries(
    conn: sqlite3.Connection, table: str, entries: list[tuple[int, str, str]]
) -> int:
    if not entries:
        return 0
    conn.executemany(
        f"""
        INSERT INTO {table} (id, keyword, href)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            keyword = excluded.keyword,
            href = excluded.href
        """,
        entries,
    )
    conn.commit()
    return len(entries)


def main() -> int:
    args = parse_args()
    if args.start < 1 or args.end < 1:
        print("Start and end must be positive integers.", file=sys.stderr)
        return 2
    if args.start > args.end:
        print("Start page must be <= end page.", file=sys.stderr)
        return 2

    table = validate_table_name(args.table)

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    ensure_schema(conn, table)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    total_upserted = 0
    total_skipped = 0

    for page in range(args.start, args.end + 1):
        url = BASE_URL.format(page=page)
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"[warn] page {page}: {exc}", file=sys.stderr)
            continue

        doc = html.fromstring(response.text)
        entries = extract_entries(doc)
        page_upserted = upsert_entries(conn, table, entries)
        page_skipped = max(len(doc.xpath(XPATH)) - page_upserted, 0)

        total_upserted += page_upserted
        total_skipped += page_skipped

        print(
            f"page {page}: upserted {page_upserted} entries, skipped {page_skipped}"
        )

        if page != args.end and args.delay > 0:
            time.sleep(args.delay)

    print(
        "done: "
        f"{total_upserted} entries upserted, "
        f"{total_skipped} skipped."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
