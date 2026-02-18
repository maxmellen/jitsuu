import initSqlJs, { type Database } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

export type EntryRow = {
  id: number
  keyword: string
  href: string
  type: string
  gaiji_img_src: string
  jion: string
  jikun: string
  jikei: string
}

export type SearchResults = {
  keyword: EntryRow[]
  jion: EntryRow[]
  jikun: EntryRow[]
}

export async function loadDatabase(dbUrl: string): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: () => sqlWasmUrl,
  })

  const response = await fetch(dbUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch database: ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  return new SQL.Database(new Uint8Array(buffer))
}

export function getJikeiOptions(db: Database): string[] {
  // WORKAROUND: truncate jikei to 2 chars for hypothesis testing; remove after crawler fix + re-fetch.
  const stmt = db.prepare(
    "SELECT DISTINCT substr(jikei, 1, 2) AS jikei FROM jitsu_entries WHERE jikei != '' ORDER BY jikei",
  )
  const options: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { jikei?: string }
    if (row.jikei) {
      options.push(row.jikei)
    }
  }
  stmt.free()
  return options
}

export function searchEntries(db: Database, query: string, jikeiFilters: string[]): SearchResults {
  const variants = buildQueryVariants(query)
  if (variants.length === 0) {
    return { keyword: [], jion: [], jikun: [] }
  }

  const fields: Array<'keyword' | 'jion' | 'jikun'> = ['keyword', 'jion', 'jikun']
  const grouped: SearchResults = { keyword: [], jion: [], jikun: [] }
  const seen = new Set<number>()

  for (const field of fields) {
    const fieldRows = runQuery(db, field, variants, jikeiFilters, 200)
    for (const row of fieldRows) {
      if (seen.has(row.id)) {
        continue
      }
      seen.add(row.id)
      grouped[field].push(row)
    }
  }

  return grouped
}

function runQuery(
  db: Database,
  field: 'keyword' | 'jion' | 'jikun',
  variants: string[],
  jikeiFilters: string[],
  limit: number,
): EntryRow[] {
  const params: Array<string> = []
  const likePatterns = new Set<string>()
  for (const variant of variants) {
    const escaped = escapeLike(variant)
    likePatterns.add(`${escaped}%`)
    likePatterns.add(`%・${escaped}%`)
  }
  const patternList = Array.from(likePatterns)
  const likeClauses = patternList.map(() => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')
  params.push(...patternList)

  let filterClause = ''
  if (jikeiFilters.length > 0) {
    const placeholders = jikeiFilters.map(() => '?').join(',')
    // WORKAROUND: truncate jikei to 2 chars for hypothesis testing; remove after crawler fix + re-fetch.
    filterClause = ` AND substr(jikei, 1, 2) IN (${placeholders})`
    params.push(...jikeiFilters)
  }

  // WORKAROUND: truncate jikei to 2 chars for hypothesis testing; remove after crawler fix + re-fetch.
  const sql = `
    SELECT id, keyword, href, type, gaiji_img_src, jion, jikun, substr(jikei, 1, 2) AS jikei
    FROM jitsu_entries
    WHERE (${likeClauses})
    ${filterClause}
    ORDER BY type = 'word', keyword
    LIMIT ${limit}
  `

  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: EntryRow[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, string | number | null>
    rows.push({
      id: Number(row.id ?? 0),
      keyword: String(row.keyword ?? ''),
      href: String(row.href ?? ''),
      type: String(row.type ?? ''),
      gaiji_img_src: String(row.gaiji_img_src ?? ''),
      jion: String(row.jion ?? ''),
      jikun: String(row.jikun ?? ''),
      jikei: String(row.jikei ?? ''),
    })
  }
  stmt.free()
  return rows
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function buildQueryVariants(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }
  const variants = new Set<string>()
  variants.add(trimmed)
  variants.add(toHiragana(trimmed))
  variants.add(toKatakana(trimmed))
  return Array.from(variants).filter((item) => item.length > 0)
}

function toKatakana(value: string): string {
  return value.replace(/[\u3041-\u3096]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
}

function toHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}
