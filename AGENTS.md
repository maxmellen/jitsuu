# Kotobank Jitsu Scraper

Purpose: Scrape Kotobank Jitsu keyword lists into SQLite.

Setup
- Install uv (see official uv docs).
- Create venv: `uv venv`
- Install deps + lock: `uv sync`
- Python version: `3.14.3` (see `.python-version`)

Run
- Default run: `uv run python scripts/scrape_kotobank_jitsu.py`
- One page: `uv run python scripts/scrape_kotobank_jitsu.py --start 1 --end 1`
- Custom DB: `--db data/kotobank.sqlite`
- Custom table: `--table jitsu_entries`
- Delay between requests: `--delay 1.0`

Output
- DB: `data/kotobank.sqlite`
- Table: `jitsu_entries`
- Columns: `id` (INTEGER PRIMARY KEY), `keyword` (TEXT), `href` (TEXT)

Tooling
- Format: `uv run ruff format /Users/maxmellen/Developer/jithree`
- Typecheck: `uv run ty check /Users/maxmellen/Developer/jithree`
