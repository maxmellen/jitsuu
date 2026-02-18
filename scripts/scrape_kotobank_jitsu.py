#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import threading
import time
from queue import Queue
from pathlib import Path
from urllib.parse import urlparse

import requests
from lxml import html

INDEX_URL_TEMPLATE = "https://kotobank.jp/dictionary/jitsu/{page}/"
ENTRY_BASE_URL = "https://kotobank.jp"

XPATH_INDEX_LINKS = '//*[@id="mainArea"]/section/ul/li/a'
XPATH_GAIJI_IMG = (
    '//*[@id="mainArea"]/article[@class="dictype cf jitsu"]/div[2]/h3/span/img'
)
XPATH_DESC = '//*[@id="mainArea"]/article[@class="dictype cf jitsu"]/div[2]/section[@class="description"]'
XPATH_DESC_HEADS = '//*[@id="mainArea"]/article[@class="dictype cf jitsu"]/div[2]/section[@class="description"]/span[@class="head"]'

USER_AGENT = "Mozilla/5.0 (compatible; kotobank-jitsu-scraper/0.1)"
REQUEST_TIMEOUT_SECONDS = 20

KANJI_SUFFIX_RE = re.compile(r"\s*\(漢字\)\s*$")
ID_RE = re.compile(r"-([0-9]+)(?:#|$)")
TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

HEAD_LABEL_MAP = {
    "[字音]": "jion",
    "[字訓]": "jikun",
    "[字形]": "jikei",
}

SENTINEL: tuple[int, str] = (-1, "")


def parse_crawl_modes(value: str) -> set[str]:
    items = [item.strip().lower() for item in value.split(",") if item.strip()]
    if not items:
        raise argparse.ArgumentTypeError(
            "--crawl must include at least one of: index, entries"
        )
    modes: set[str] = set()
    for item in items:
        if item == "index":
            modes.add("index")
        elif item in {"entries", "kanji_entries"}:
            modes.add("entries")
        else:
            raise argparse.ArgumentTypeError(
                "--crawl supports: index, entries (or kanji_entries)"
            )
    return modes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape Kotobank Jitsu keyword lists into SQLite."
    )
    parser.add_argument(
        "--crawl",
        type=parse_crawl_modes,
        default=parse_crawl_modes("index"),
        help="Comma-separated: index, entries (kanji_entries). Default: index",
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
    parser.add_argument(
        "--kanji-only",
        action="store_true",
        help="Only keep entries whose keyword includes '(漢字)' before stripping (index crawl only).",
    )
    parser.add_argument(
        "--vacuum",
        action="store_true",
        help="Run WAL checkpoint, VACUUM, and PRAGMA optimize after crawling.",
    )
    return parser.parse_args()


def validate_table_name(table: str) -> str:
    if not TABLE_RE.fullmatch(table):
        raise ValueError(
            "Table name must be alphanumeric/underscore and start with a letter or _."
        )
    return table


def configure_sqlite(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")


def ensure_schema(conn: sqlite3.Connection, table: str) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table} (
            id INTEGER PRIMARY KEY,
            keyword TEXT NOT NULL,
            href TEXT NOT NULL,
            type TEXT NOT NULL,
            gaiji_img_src TEXT,
            jion TEXT,
            jikun TEXT,
            jikei TEXT
        )
        """
    )
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if "type" not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN type TEXT")
    for column in ("gaiji_img_src", "jion", "jikun", "jikei"):
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT")
    conn.commit()


def ensure_indexes(conn: sqlite3.Connection, table: str) -> None:
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_keyword ON {table}(keyword)")
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_type ON {table}(type)")
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_jion ON {table}(jion)")
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_jikun ON {table}(jikun)")
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_jikei ON {table}(jikei)")
    conn.commit()


def extract_entries(
    doc: html.HtmlElement, *, kanji_only: bool
) -> list[tuple[int, str, str, str]]:
    entries: list[tuple[int, str, str, str]] = []
    for anchor in doc.xpath(XPATH_INDEX_LINKS):
        keyword_raw = anchor.text_content().strip()
        if not keyword_raw:
            continue
        is_kanji = "(漢字)" in keyword_raw
        if kanji_only and not is_kanji:
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
        entry_type = "kanji" if is_kanji else "word"
        entries.append((entry_id, keyword, href, entry_type))
    return entries


def upsert_entries(
    conn: sqlite3.Connection, table: str, entries: list[tuple[int, str, str, str]]
) -> int:
    if not entries:
        return 0
    conn.executemany(
        f"""
        INSERT INTO {table} (id, keyword, href, type)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            keyword = excluded.keyword,
            href = excluded.href,
            type = excluded.type
        """,
        entries,
    )
    conn.commit()
    return len(entries)


def normalize_image_src(src: str) -> str:
    if not src:
        return ""
    if src.startswith("//"):
        parsed = urlparse(f"https:{src}")
        return parsed.path + (f"?{parsed.query}" if parsed.query else "")
    if src.startswith("http://") or src.startswith("https://"):
        parsed = urlparse(src)
        return parsed.path + (f"?{parsed.query}" if parsed.query else "")
    return src


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def parse_description(desc_elem: html.HtmlElement) -> dict[str, str]:
    values = {"jion": "", "jikun": "", "jikei": ""}
    for head in desc_elem.xpath("./span[@class='head']"):
        label = (head.text_content() or "").strip()
        key = HEAD_LABEL_MAP.get(label)
        if not key:
            continue
        parts: list[str] = []
        if head.tail:
            parts.append(head.tail)
        for sibling in head.itersiblings():
            if sibling.tag == "span" and "head" in (sibling.get("class") or "").split():
                break
            if sibling.text:
                parts.append(sibling.text)
            if sibling.tail:
                parts.append(sibling.tail)
        values[key] = normalize_text("".join(parts))
    return values


def fetch_entry_details(
    session: requests.Session, href: str
) -> tuple[str, str, str, str]:
    url = f"{ENTRY_BASE_URL}{href}"
    response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    doc = html.fromstring(response.text)

    gaiji_img_src = ""
    img_nodes = doc.xpath(XPATH_GAIJI_IMG)
    if img_nodes:
        gaiji_img_src = normalize_image_src(img_nodes[0].get("src") or "")

    jion = ""
    jikun = ""
    jikei = ""
    desc_nodes = doc.xpath(XPATH_DESC)
    if desc_nodes:
        values = parse_description(desc_nodes[0])
        jion = values.get("jion", "")
        jikun = values.get("jikun", "")
        jikei = values.get("jikei", "")

    return gaiji_img_src, jion, jikun, jikei


def update_entry_details(
    conn: sqlite3.Connection,
    table: str,
    entry_id: int,
    gaiji_img_src: str,
    jion: str,
    jikun: str,
    jikei: str,
) -> None:
    conn.execute(
        f"""
        UPDATE {table}
        SET gaiji_img_src = ?,
            jion = ?,
            jikun = ?,
            jikei = ?
        WHERE id = ?
        """,
        (gaiji_img_src, jion, jikun, jikei, entry_id),
    )
    conn.commit()


def should_process_row(row: sqlite3.Row) -> bool:
    return any(row[col] is None for col in ("gaiji_img_src", "jion", "jikun", "jikei"))


def crawl_index_pages(
    db_path: Path,
    table: str,
    start: int,
    end: int,
    delay: float,
    kanji_only: bool,
    queue: Queue | None,
) -> None:
    conn = sqlite3.connect(str(db_path))
    configure_sqlite(conn)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    total_upserted = 0
    total_skipped = 0

    for page in range(start, end + 1):
        url = INDEX_URL_TEMPLATE.format(page=page)
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"[warn] page {page}: {exc}", file=sys.stderr)
            continue

        doc = html.fromstring(response.text)
        entries = extract_entries(doc, kanji_only=kanji_only)
        page_upserted = upsert_entries(conn, table, entries)
        page_skipped = max(len(doc.xpath(XPATH_INDEX_LINKS)) - page_upserted, 0)

        total_upserted += page_upserted
        total_skipped += page_skipped

        if queue is not None:
            for entry_id, _keyword, href, entry_type in entries:
                if entry_type == "kanji":
                    queue.put((entry_id, href))

        print(f"page {page}: upserted {page_upserted} entries, skipped {page_skipped}")

        if page != end and delay > 0:
            time.sleep(delay)

    print(f"index done: {total_upserted} entries upserted, {total_skipped} skipped.")


def crawl_entry_pages_from_db(db_path: Path, table: str, delay: float) -> None:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    configure_sqlite(conn)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    rows = conn.execute(
        f"""
        SELECT id, href, gaiji_img_src, jion, jikun, jikei
        FROM {table}
        WHERE type = 'kanji'
          AND (gaiji_img_src IS NULL OR jion IS NULL OR jikun IS NULL OR jikei IS NULL)
        ORDER BY id
        """
    ).fetchall()

    processed = 0
    skipped = 0

    for row in rows:
        entry_id = row["id"]
        href = row["href"]
        if not href:
            skipped += 1
            continue
        try:
            gaiji_img_src, jion, jikun, jikei = fetch_entry_details(session, href)
        except requests.RequestException as exc:
            print(f"[warn] entry {entry_id}: {exc}", file=sys.stderr)
            continue
        update_entry_details(conn, table, entry_id, gaiji_img_src, jion, jikun, jikei)
        processed += 1
        print(f"entry {entry_id}: updated")
        if delay > 0:
            time.sleep(delay)

    print(f"entries done: processed {processed}, skipped {skipped}.")


def crawl_entry_pages_from_queue(
    db_path: Path, table: str, delay: float, queue: Queue
) -> None:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    configure_sqlite(conn)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    seen: set[int] = set()
    processed = 0
    skipped = 0

    while True:
        entry_id, href = queue.get()
        if (entry_id, href) == SENTINEL:
            queue.task_done()
            break
        if entry_id in seen:
            skipped += 1
            queue.task_done()
            continue
        seen.add(entry_id)

        row = conn.execute(
            f"""
            SELECT id, href, type, gaiji_img_src, jion, jikun, jikei
            FROM {table}
            WHERE id = ?
            """,
            (entry_id,),
        ).fetchone()
        if not row or row["type"] != "kanji":
            skipped += 1
            queue.task_done()
            continue
        if not should_process_row(row):
            skipped += 1
            queue.task_done()
            continue

        entry_href = row["href"] or href
        if not entry_href:
            skipped += 1
            queue.task_done()
            continue

        try:
            gaiji_img_src, jion, jikun, jikei = fetch_entry_details(session, entry_href)
        except requests.RequestException as exc:
            print(f"[warn] entry {entry_id}: {exc}", file=sys.stderr)
            queue.task_done()
            continue

        update_entry_details(conn, table, entry_id, gaiji_img_src, jion, jikun, jikei)
        processed += 1
        print(f"entry {entry_id}: updated")
        if delay > 0:
            time.sleep(delay)
        queue.task_done()

    print(f"entries done: processed {processed}, skipped {skipped}.")


def main() -> int:
    args = parse_args()
    if args.start < 1 or args.end < 1:
        print("Start and end must be positive integers.", file=sys.stderr)
        return 2
    if args.start > args.end:
        print("Start page must be <= end page.", file=sys.stderr)
        return 2

    crawl_modes = args.crawl
    if "index" not in crawl_modes and args.kanji_only:
        print("[warn] --kanji-only is only used with --crawl=index", file=sys.stderr)

    table = validate_table_name(args.table)

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    configure_sqlite(conn)
    ensure_schema(conn, table)
    ensure_indexes(conn, table)
    conn.close()

    def run_vacuum() -> None:
        if not args.vacuum:
            return
        vacuum_conn = sqlite3.connect(str(db_path))
        configure_sqlite(vacuum_conn)
        vacuum_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        vacuum_conn.execute("VACUUM")
        vacuum_conn.execute("PRAGMA optimize")
        vacuum_conn.close()

    if crawl_modes == {"index"}:
        crawl_index_pages(
            db_path,
            table,
            args.start,
            args.end,
            args.delay,
            args.kanji_only,
            queue=None,
        )
        run_vacuum()
        return 0

    if crawl_modes == {"entries"}:
        crawl_entry_pages_from_db(db_path, table, args.delay)
        run_vacuum()
        return 0

    if crawl_modes == {"index", "entries"}:
        queue: Queue[tuple[int, str]] = Queue(maxsize=1000)
        entry_thread = threading.Thread(
            target=crawl_entry_pages_from_queue,
            args=(db_path, table, args.delay, queue),
            daemon=True,
        )
        entry_thread.start()

        crawl_index_pages(
            db_path,
            table,
            args.start,
            args.end,
            args.delay,
            args.kanji_only,
            queue=queue,
        )
        queue.put(SENTINEL)
        queue.join()
        entry_thread.join()
        run_vacuum()
        return 0

    print("[error] invalid crawl mode selection", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
