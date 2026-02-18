# Kotobank Jitsu Scraper

Purpose: Scrape Kotobank Jitsu keyword lists into SQLite.

Setup
- Install uv (see official uv docs).
- Create venv: `uv venv`
- Install deps + lock: `uv sync`
- Python version: `3.14.3` (see `.python-version`)

Run
- Index crawl (default): `uv run python scripts/scrape_kotobank_jitsu.py --crawl=index`
- Entry crawl (per-entry fields): `uv run python scripts/scrape_kotobank_jitsu.py --crawl=entries`
- Both concurrently: `uv run python scripts/scrape_kotobank_jitsu.py --crawl=index,entries`
- Kanji-only index entries: `uv run python scripts/scrape_kotobank_jitsu.py --crawl=index --kanji-only`
- Vacuum DB after crawl: `uv run python scripts/scrape_kotobank_jitsu.py --crawl=index --vacuum`
- Custom DB: `--db data/kotobank.sqlite`
- Custom table: `--table jitsu_entries`
- Delay between requests: `--delay 1.0`

Output
- DB: `data/kotobank.sqlite`
- Table: `jitsu_entries`
- Columns:
  - `id` (INTEGER PRIMARY KEY)
  - `keyword` (TEXT)
  - `href` (TEXT)
  - `type` (TEXT: `kanji` or `word`)
  - `gaiji_img_src` (TEXT)
  - `jion` (TEXT)
  - `jikun` (TEXT)
  - `jikei` (TEXT)
Tooling
- Format: `uv run ruff format /Users/maxmellen/Developer/jithree`
- Typecheck: `uv run ty check /Users/maxmellen/Developer/jithree`
- Frontend format: `pnpm run format` (in `/Users/maxmellen/Developer/jithree/client`)
- Frontend lint: `pnpm run lint` (in `/Users/maxmellen/Developer/jithree/client`, Biome)
- Frontend typecheck: `pnpm run typecheck` (in `/Users/maxmellen/Developer/jithree/client`)
Frontend docs
- Client search & sorting: `client/search.md`
Frontend deploy
- Vite base is configured for `/jitsuu/` subpath in `client/vite.config.ts`.

Quality
- After code changes, run `ruff format` and `ty check`.
- After frontend changes, run `pnpm run format`, `pnpm run lint`, and `pnpm run typecheck` in `client/`.
- Run frontend checks once after implementing frontend plans.
- Update this document when architectural changes alter usage or structure.
