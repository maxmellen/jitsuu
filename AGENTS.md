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
- Kanji-only entries: `uv run python scripts/scrape_kotobank_jitsu.py --kanji-only`
- Collect gaiji images: `uv run python scripts/collect_gaiji_images.py`
- Apply gaiji transcriptions: `uv run python scripts/apply_gaiji_transcriptions.py --csv data/gaiji_transcriptions.csv`
- Generate gaiji report: `uv run python scripts/generate_gaiji_report.py`
- Custom DB: `--db data/kotobank.sqlite`
- Custom table: `--table jitsu_entries`
- Delay between requests: `--delay 1.0`

Output
- DB: `data/kotobank.sqlite`
- Table: `jitsu_entries`
- Columns: `id` (INTEGER PRIMARY KEY), `keyword` (TEXT), `href` (TEXT), `type` (TEXT: `kanji` or `word`)
- Table: `jitsu_gaiji`
- Columns: `entry_id` (INTEGER PRIMARY KEY), `image_src` (TEXT), `gaiji_char` (TEXT, nullable)

Tooling
- Format: `uv run ruff format /Users/maxmellen/Developer/jithree`
- Typecheck: `uv run ty check /Users/maxmellen/Developer/jithree`
