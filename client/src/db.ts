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

export type SearchResult = {
  field: 'keyword' | 'jion' | 'jikun'
  rows: EntryRow[]
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
  const stmt = db.prepare(
    "SELECT DISTINCT jikei FROM jitsu_entries WHERE jikei != '' ORDER BY jikei",
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

export function searchEntries(
  db: Database,
  query: string,
  jikeiFilters: string[],
): SearchResult | null {
  const sanitized = escapeLike(query)
  const likeValue = `%${sanitized}%`

  const fields: Array<SearchResult['field']> = ['keyword', 'jion', 'jikun']
  for (const field of fields) {
    const rows = runQuery(db, field, likeValue, jikeiFilters)
    if (rows.length > 0) {
      return { field, rows }
    }
  }
  return { field: 'jikun', rows: [] }
}

function runQuery(
  db: Database,
  field: SearchResult['field'],
  likeValue: string,
  jikeiFilters: string[],
): EntryRow[] {
  const params: Array<string> = [likeValue]
  let filterClause = ''
  if (jikeiFilters.length > 0) {
    const placeholders = jikeiFilters.map(() => '?').join(',')
    filterClause = ` AND jikei IN (${placeholders})`
    params.push(...jikeiFilters)
  }

  const sql = `
    SELECT id, keyword, href, type, gaiji_img_src, jion, jikun, jikei
    FROM jitsu_entries
    WHERE ${field} LIKE ? ESCAPE '\\'
    ${filterClause}
    ORDER BY type = 'word', keyword
    LIMIT 200
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
