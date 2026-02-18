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
  if (variants.length === 0 && jikeiFilters.length === 0) {
    return { keyword: [], jion: [], jikun: [] }
  }

  const fields: Array<'keyword' | 'jion' | 'jikun'> = ['keyword', 'jion', 'jikun']
  const grouped: SearchResults = { keyword: [], jion: [], jikun: [] }
  const seen = new Set<number>()

  if (variants.length === 0) {
    grouped.keyword = runFilterOnly(db, jikeiFilters, 200).sort(makeComparator('keyword', []))
    return grouped
  }

  for (const field of fields) {
    const fieldRows = runQuery(db, field, variants, jikeiFilters, 200)
    for (const row of fieldRows) {
      if (seen.has(row.id)) {
        continue
      }
      let target: keyof SearchResults = field
      if (field === 'keyword' && row.gaiji_img_src && isKanaOnlyKeyword(row.keyword)) {
        if (matchesSegmentPrefix(row.jion, variants)) {
          target = 'jion'
        } else if (matchesSegmentPrefix(row.jikun, variants)) {
          target = 'jikun'
        }
      }
      seen.add(row.id)
      grouped[target].push(row)
    }
  }

  grouped.keyword.sort(makeComparator('keyword', variants))
  grouped.jion.sort(makeComparator('jion', variants))
  grouped.jikun.sort(makeComparator('jikun', variants))

  return grouped
}

function isKanaOnlyKeyword(value: string): boolean {
  return value.length > 0 && !/[\u4E00-\u9FFF]/.test(value)
}

function matchesSegmentPrefix(value: string, variants: string[]): boolean {
  if (!value) {
    return false
  }
  for (const variant of variants) {
    if (!variant) {
      continue
    }
    if (value.startsWith(variant) || value.includes(`・${variant}`)) {
      return true
    }
  }
  return false
}

function runFilterOnly(db: Database, jikeiFilters: string[], limit: number): EntryRow[] {
  if (jikeiFilters.length === 0) {
    return []
  }

  const params: Array<string> = []
  const placeholders = jikeiFilters.map(() => '?').join(',')
  // WORKAROUND: truncate jikei to 2 chars for hypothesis testing; remove after crawler fix + re-fetch.
  const filterClause = `WHERE substr(jikei, 1, 2) IN (${placeholders})`
  params.push(...jikeiFilters)

  // WORKAROUND: truncate jikei to 2 chars for hypothesis testing; remove after crawler fix + re-fetch.
  const sql = `
    SELECT id, keyword, href, type, gaiji_img_src, jion, jikun, substr(jikei, 1, 2) AS jikei
    FROM jitsu_entries
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

const jaCollator = new Intl.Collator('ja')

function normalizeReadingSegment(text: string): string {
  return text
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
}

function splitReadingSegments(value: string): string[] {
  return value
    .split('・')
    .map((segment) => normalizeReadingSegment(segment))
    .filter((segment) => segment.length > 0)
}

function matchSegmentIndex(value: string, variants: string[]): number {
  if (!value || variants.length === 0) {
    return Number.POSITIVE_INFINITY
  }
  const segments = splitReadingSegments(value)
  if (segments.length === 0) {
    return Number.POSITIVE_INFINITY
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    for (const variant of variants) {
      if (!variant) {
        continue
      }
      if (segment.startsWith(variant)) {
        return index
      }
    }
  }
  return Number.POSITIVE_INFINITY
}

function makeComparator(group: keyof SearchResults, variants: string[]) {
  return (left: EntryRow, right: EntryRow): number => {
    const primaryLeft =
      group === 'jikun'
        ? matchSegmentIndex(left.jikun, variants)
        : matchSegmentIndex(left.jion, variants)
    const primaryRight =
      group === 'jikun'
        ? matchSegmentIndex(right.jikun, variants)
        : matchSegmentIndex(right.jion, variants)
    if (primaryLeft !== primaryRight) {
      return primaryLeft - primaryRight
    }

    const secondaryLeft =
      group === 'jikun'
        ? matchSegmentIndex(left.jion, variants)
        : matchSegmentIndex(left.jikun, variants)
    const secondaryRight =
      group === 'jikun'
        ? matchSegmentIndex(right.jion, variants)
        : matchSegmentIndex(right.jikun, variants)
    if (secondaryLeft !== secondaryRight) {
      return secondaryLeft - secondaryRight
    }

    const jionCompare = compareNullable(left.jion, right.jion)
    if (jionCompare !== 0) {
      return jionCompare
    }
    const jikunCompare = compareNullable(left.jikun, right.jikun)
    if (jikunCompare !== 0) {
      return jikunCompare
    }
    return left.id - right.id
  }
}

function compareNullable(left: string, right: string): number {
  const leftEmpty = !left
  const rightEmpty = !right
  if (leftEmpty && rightEmpty) {
    return 0
  }
  if (leftEmpty) {
    return 1
  }
  if (rightEmpty) {
    return -1
  }
  return jaCollator.compare(left, right)
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
