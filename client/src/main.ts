import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { getJikeiOptions, loadDatabase, searchEntries, type EntryRow } from './db'

const APP_SELECTOR = '#app'
const DB_URL = '/kotobank.sqlite'
const GAIJI_BASE_URL = 'https://kotobank.jp'

const app = document.querySelector<HTMLDivElement>(APP_SELECTOR)
if (!app) {
  throw new Error('App container not found')
}
const root = app

root.innerHTML = `
  <div class="app">
    <header class="hero">
      <h1 class="hero-title">字通検索</h1>
      <p class="hero-subtitle">字音・字訓・字形まで、ローカルで素早く検索。</p>
    </header>
    <section class="controls">
      <div class="search-field">
        <span class="search-label">Search</span>
        <input
          class="search-input"
          id="search-input"
          type="search"
          placeholder="例: 亜 / ア / あげまき"
          autocomplete="off"
        />
      </div>
      <div class="filters">
        <div class="filters-header">
          <div class="filters-title">字形</div>
          <button type="button" class="filters-clear" id="clear-filters">Clear</button>
        </div>
        <div class="filter-list" id="jikei-filters"></div>
      </div>
    </section>
    <section class="status">
      <span id="status-text">Loading database…</span>
      <span id="result-count"></span>
    </section>
    <section class="results" id="results"></section>
  </div>
`

const searchInput = mustGet<HTMLInputElement>('#search-input')
const statusText = mustGet<HTMLSpanElement>('#status-text')
const resultCount = mustGet<HTMLSpanElement>('#result-count')
const resultsContainer = mustGet<HTMLDivElement>('#results')
const filtersContainer = mustGet<HTMLDivElement>('#jikei-filters')
const clearFiltersButton = mustGet<HTMLButtonElement>('#clear-filters')

searchInput.disabled = true

let db: import('sql.js').Database | null = null
let jikeiOptions: string[] = []
const selectedJikei = new Set<string>()
let searchTimeout: number | undefined

if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}

void init()

async function init(): Promise<void> {
  try {
    db = await loadDatabase(DB_URL)
    jikeiOptions = getJikeiOptions(db)
    renderFilters()
    searchInput.disabled = false
    searchInput.focus()
    statusText.textContent = 'Ready'

    searchInput.addEventListener('input', () => scheduleSearch())
    clearFiltersButton.addEventListener('click', () => {
      selectedJikei.clear()
      renderFilters()
      scheduleSearch()
    })
  } catch (error) {
    console.error(error)
    statusText.textContent = 'Failed to load database'
  }
}

function scheduleSearch(): void {
  if (!db) {
    return
  }
  if (searchTimeout) {
    window.clearTimeout(searchTimeout)
  }
  searchTimeout = window.setTimeout(() => runSearch(), 220)
}

function runSearch(): void {
  if (!db) {
    return
  }
  const query = searchInput.value.trim()
  if (!query) {
    resultsContainer.innerHTML = ''
    resultCount.textContent = ''
    statusText.textContent = 'Type to search'
    return
  }

  const filters = Array.from(selectedJikei.values())
  const result = searchEntries(db, query, filters)

  const rows = result?.rows ?? []
  if (rows.length === 0) {
    resultsContainer.innerHTML = '<div class="empty-state">No matches found.</div>'
    resultCount.textContent = '0 results'
    statusText.textContent = 'No matches'
    return
  }

  statusText.textContent = `Matched by ${result?.field ?? 'keyword'}`
  resultCount.textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`
  renderResults(rows)
}

function renderFilters(): void {
  filtersContainer.innerHTML = ''

  if (jikeiOptions.length === 0) {
    filtersContainer.innerHTML = '<div class="empty-state">字形の候補がありません。</div>'
    return
  }

  for (const [index, option] of jikeiOptions.entries()) {
    const label = document.createElement('label')
    label.className = 'filter-chip'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.value = option
    checkbox.checked = selectedJikei.has(option)
    checkbox.id = `jikei-${index}`
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedJikei.add(option)
      } else {
        selectedJikei.delete(option)
      }
      scheduleSearch()
    })

    const text = document.createElement('span')
    text.textContent = option

    label.appendChild(checkbox)
    label.appendChild(text)
    filtersContainer.appendChild(label)
  }
}

function renderResults(rows: EntryRow[]): void {
  resultsContainer.innerHTML = ''
  const fragment = document.createDocumentFragment()

  for (const row of rows) {
    const card = document.createElement('article')
    card.className = 'result-card'

    const kanjiBlock = document.createElement('div')
    kanjiBlock.className = 'kanji-block'

    const glyph = document.createElement('div')
    glyph.className = 'kanji-glyph'

    if (row.gaiji_img_src) {
      const img = document.createElement('img')
      img.src = `${GAIJI_BASE_URL}${row.gaiji_img_src}`
      img.alt = row.keyword
      glyph.appendChild(img)
    } else {
      glyph.textContent = row.keyword
    }

    const badge = document.createElement('div')
    badge.className = 'kanji-badge'
    badge.textContent = row.jikei || '—'

    kanjiBlock.appendChild(glyph)
    kanjiBlock.appendChild(badge)

    const readings = document.createElement('div')
    readings.className = 'readings'

    readings.appendChild(createReadingRow('音', row.jion))
    readings.appendChild(createReadingRow('訓', row.jikun))

    card.appendChild(kanjiBlock)
    card.appendChild(readings)
    fragment.appendChild(card)
  }

  resultsContainer.appendChild(fragment)
}

function createReadingRow(labelText: string, value: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'reading-row'

  const label = document.createElement('div')
  label.className = 'reading-label'
  label.textContent = labelText

  const valueEl = document.createElement('div')
  valueEl.className = 'reading-value'
  valueEl.textContent = value || '—'

  row.appendChild(label)
  row.appendChild(valueEl)
  return row
}

function mustGet<T extends Element>(selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }
  return element
}
