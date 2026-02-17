#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
from pathlib import Path

TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply gaiji transcriptions from a CSV file."
    )
    parser.add_argument(
        "--db",
        default="data/kotobank.sqlite",
        help="SQLite DB path (default: data/kotobank.sqlite)",
    )
    parser.add_argument(
        "--gaiji-table",
        default="jitsu_gaiji",
        help="Gaiji table name (default: jitsu_gaiji)",
    )
    parser.add_argument(
        "--csv",
        default="data/gaiji_transcriptions.csv",
        help="CSV path with entry_id,gaiji_char (default: data/gaiji_transcriptions.csv)",
    )
    return parser.parse_args()


def validate_table_name(table: str) -> str:
    if not TABLE_RE.fullmatch(table):
        raise ValueError(
            "Table name must be alphanumeric/underscore and start with a letter or _."
        )
    return table


def read_rows(csv_path: Path) -> list[tuple[int, str]]:
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV must include headers: entry_id,gaiji_char")
        if "entry_id" not in reader.fieldnames or "gaiji_char" not in reader.fieldnames:
            raise ValueError("CSV headers must include entry_id and gaiji_char")
        rows: list[tuple[int, str]] = []
        for row in reader:
            entry_id_raw = (row.get("entry_id") or "").strip()
            gaiji_char = (row.get("gaiji_char") or "").strip()
            if not entry_id_raw or not gaiji_char:
                continue
            rows.append((int(entry_id_raw), gaiji_char))
        return rows


def main() -> int:
    args = parse_args()
    gaiji_table = validate_table_name(args.gaiji_table)

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 2

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 2

    rows = read_rows(csv_path)
    if not rows:
        print("No rows to apply.", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(db_path))
    updated = 0
    missing = 0
    for entry_id, gaiji_char in rows:
        cur = conn.execute(
            f"UPDATE {gaiji_table} SET gaiji_char = ? WHERE entry_id = ?",
            (gaiji_char, entry_id),
        )
        if cur.rowcount:
            updated += 1
        else:
            missing += 1
    conn.commit()

    print(f"updated {updated} rows, missing {missing} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
