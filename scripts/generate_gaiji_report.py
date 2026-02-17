#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html as html_lib
import re
import sqlite3
import sys
from pathlib import Path

BASE_URL = "https://kotobank.jp"
TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a gaiji HTML report.")
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
        "--output",
        default="data/gaiji_report.html",
        help="Output HTML path (default: data/gaiji_report.html)",
    )
    return parser.parse_args()


def validate_table_name(table: str) -> str:
    if not TABLE_RE.fullmatch(table):
        raise ValueError(
            "Table name must be alphanumeric/underscore and start with a letter or _."
        )
    return table


def build_img_src(image_src: str) -> str:
    if image_src.startswith("http://") or image_src.startswith("https://"):
        return image_src
    return f"{BASE_URL}{image_src}"


def main() -> int:
    args = parse_args()
    entries_table = validate_table_name(args.entries_table)
    gaiji_table = validate_table_name(args.gaiji_table)

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 2

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        f"""
        SELECT g.entry_id, g.image_src, g.gaiji_char, e.keyword, e.href
        FROM {gaiji_table} g
        JOIN {entries_table} e ON e.id = g.entry_id
        ORDER BY g.entry_id
        """
    ).fetchall()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    lines.append("<!doctype html>")
    lines.append("<html lang=\"ja\">")
    lines.append("<head>")
    lines.append("  <meta charset=\"utf-8\">")
    lines.append("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
    lines.append("  <title>Jitsu Gaiji Report</title>")
    lines.append("  <style>")
    lines.append("    body { font-family: system-ui, sans-serif; margin: 24px; }")
    lines.append("    table { border-collapse: collapse; width: 100%; }")
    lines.append("    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }")
    lines.append("    th { background: #f3f3f3; text-align: left; }")
    lines.append("    img { max-height: 48px; }")
    lines.append("    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }")
    lines.append("  </style>")
    lines.append("</head>")
    lines.append("<body>")
    lines.append(f"  <h1>Jitsu Gaiji Report ({len(rows)} entries)</h1>")
    lines.append("  <table>")
    lines.append("    <thead>")
    lines.append("      <tr>")
    lines.append("        <th>ID</th>")
    lines.append("        <th>Keyword</th>")
    lines.append("        <th>Href</th>")
    lines.append("        <th>Image</th>")
    lines.append("        <th>Gaiji Char</th>")
    lines.append("      </tr>")
    lines.append("    </thead>")
    lines.append("    <tbody>")

    for row in rows:
        entry_id = html_lib.escape(str(row["entry_id"]))
        keyword = html_lib.escape(row["keyword"] or "")
        href = html_lib.escape(row["href"] or "")
        image_src = build_img_src(row["image_src"])
        image_src_esc = html_lib.escape(image_src)
        gaiji_char = html_lib.escape(row["gaiji_char"] or "")
        lines.append("      <tr>")
        lines.append(f"        <td class=\"mono\">{entry_id}</td>")
        lines.append(f"        <td>{keyword}</td>")
        lines.append(
            f"        <td class=\"mono\"><a href=\"{BASE_URL}{href}\">{href}</a></td>"
        )
        lines.append(
            f"        <td><img src=\"{image_src_esc}\" alt=\"gaiji\"></td>"
        )
        lines.append(f"        <td>{gaiji_char}</td>")
        lines.append("      </tr>")

    lines.append("    </tbody>")
    lines.append("  </table>")
    lines.append("</body>")
    lines.append("</html>")

    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
