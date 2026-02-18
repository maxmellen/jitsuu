import './style.css'
import {
  getJikeiOptions,
  loadDatabase,
  searchEntries,
  type EntryRow,
  type SearchResults,
} from './db'

const APP_SELECTOR = '#app'
const DB_URL = `${import.meta.env.BASE_URL}kotobank.sqlite`
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
    <section class="layout">
      <div class="sidebar">
        <div class="search-field">
          <span class="search-label">検索</span>
          <input
            class="search-input"
            id="search-input"
            type="search"
            placeholder="例: 亜 / ア / あげまき"
            autocomplete="off"
          />
        </div>
        <div class="filters-panel">
          <div class="filters-header">
            <div class="filters-title">字形</div>
            <div class="filters-actions">
              <button
                type="button"
                class="filters-toggle"
                id="toggle-filters"
                aria-expanded="false"
                aria-controls="filters-body"
              >
                展開
              </button>
              <button type="button" class="filters-clear" id="clear-filters">解除</button>
            </div>
          </div>
          <div class="filters-body" id="filters-body">
            <div class="filter-list" id="jikei-filters"></div>
          </div>
        </div>
      </div>
      <div class="content">
        <section class="status">
          <span id="status-text">データベース読込中…</span>
        </section>
        <section class="results" id="results"></section>
      </div>
    </section>
    <button type="button" class="scroll-top" id="scroll-top" aria-label="上へ">
      上へ
    </button>
  </div>
`

const searchInput = mustGet<HTMLInputElement>('#search-input')
const statusText = mustGet<HTMLSpanElement>('#status-text')
const resultsContainer = mustGet<HTMLDivElement>('#results')
const filtersContainer = mustGet<HTMLDivElement>('#jikei-filters')
const clearFiltersButton = mustGet<HTMLButtonElement>('#clear-filters')
const toggleFiltersButton = mustGet<HTMLButtonElement>('#toggle-filters')
const filtersBody = mustGet<HTMLDivElement>('#filters-body')
const scrollTopButton = mustGet<HTMLButtonElement>('#scroll-top')

searchInput.disabled = true

let db: import('sql.js').Database | null = null
let jikeiOptions: string[] = []
const selectedJikei = new Set<string>()
let searchTimeout: number | undefined
let filtersOpen = false
let applyingUrlState = false

void init()

async function init(): Promise<void> {
  try {
    db = await loadDatabase(DB_URL)
    jikeiOptions = getJikeiOptions(db)
    applyUrlState()
    renderFilters()
    setFiltersOpen(window.matchMedia('(min-width: 900px)').matches)
    searchInput.disabled = false
    searchInput.focus()
    statusText.textContent = '準備完了'
    runSearch()

    searchInput.addEventListener('input', () => scheduleSearch())
    clearFiltersButton.addEventListener('click', () => {
      selectedJikei.clear()
      renderFilters()
      scheduleSearch()
    })
    toggleFiltersButton.addEventListener('click', () => setFiltersOpen(!filtersOpen))
    scrollTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
    window.addEventListener('scroll', () => {
      scrollTopButton.classList.toggle('is-visible', window.scrollY >= 300)
    })
    scrollTopButton.classList.remove('is-visible')
    window.addEventListener('popstate', () => {
      applyUrlState()
      renderFilters()
      runSearch()
    })
  } catch (error) {
    console.error(error)
    statusText.textContent = '読込に失敗しました'
  }
}

function setFiltersOpen(open: boolean): void {
  filtersOpen = open
  filtersBody.hidden = !open
  toggleFiltersButton.setAttribute('aria-expanded', String(open))
  toggleFiltersButton.textContent = open ? '折畳' : '展開'
}

function readUrlState(): { query: string; filters: string[] } {
  const params = new URLSearchParams(window.location.search)
  return {
    query: params.get('q') ?? '',
    filters: params.getAll('k'),
  }
}

function writeUrlState(query: string, filters: string[]): void {
  if (applyingUrlState) {
    return
  }
  const url = new URL(window.location.href)
  if (query) {
    url.searchParams.set('q', query)
  } else {
    url.searchParams.delete('q')
  }
  url.searchParams.delete('k')
  for (const filter of filters) {
    url.searchParams.append('k', filter)
  }
  history.replaceState(null, '', url)
}

function applyUrlState(): void {
  applyingUrlState = true
  const { query, filters } = readUrlState()
  searchInput.value = query
  selectedJikei.clear()
  const allowed = new Set(jikeiOptions)
  for (const filter of filters) {
    const normalized = filter === '略体' ? '国字' : filter
    if (allowed.has(normalized)) {
      selectedJikei.add(normalized)
    }
  }
  applyingUrlState = false
}

function expandJikeiFilters(filters: string[]): string[] {
  if (!filters.includes('国字')) {
    return filters
  }
  const expanded = new Set(filters)
  expanded.add('略体')
  return Array.from(expanded)
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
  const filters = expandJikeiFilters(Array.from(selectedJikei.values()))

  if (!query && filters.length === 0) {
    resultsContainer.innerHTML = ''
    statusText.textContent = '検索語を入力'
    writeUrlState('', [])
    return
  }

  const result = searchEntries(db, query, filters)
  const total = result.keyword.length + result.jion.length + result.jikun.length

  if (total === 0) {
    resultsContainer.innerHTML = '<div class="empty-state">一致する結果がありません</div>'
    statusText.textContent = '一致なし'
    writeUrlState(query, filters)
    return
  }

  statusText.textContent = query ? '検索結果' : '形'
  renderResults(result)
  writeUrlState(query, filters)
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

function renderResults(results: SearchResults): void {
  resultsContainer.innerHTML = ''
  const fragment = document.createDocumentFragment()

  const groups: Array<{ key: keyof SearchResults; label: string }> = [
    { key: 'keyword', label: '字' },
    { key: 'jion', label: '音' },
    { key: 'jikun', label: '訓' },
  ]

  const nav = document.createElement('div')
  nav.className = 'result-nav'
  const toggles: Array<{ toggle: HTMLButtonElement; list: HTMLDivElement }> = []
  let toggleAll: HTMLButtonElement | null = null

  const updateToggleAllLabel = (): void => {
    if (!toggleAll) {
      return
    }
    const anyClosed = toggles.some(({ list }) => list.hidden)
    toggleAll.textContent = anyClosed ? '全て展開' : '全て折畳'
  }

  for (const group of groups) {
    const rows = results[group.key]
    if (rows.length === 0) {
      continue
    }

    const groupSection = document.createElement('section')
    groupSection.className = 'result-group'
    groupSection.id = `group-${group.key}`

    const header = document.createElement('div')
    header.className = 'result-group-header'

    const listId = `group-${group.key}-list`
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'result-group-toggle'
    toggle.id = `group-${group.key}-toggle`
    toggle.setAttribute('aria-expanded', 'true')
    toggle.setAttribute('aria-controls', listId)

    const label = document.createElement('span')
    label.className = 'result-group-label'
    label.textContent = group.label

    const count = document.createElement('span')
    count.className = 'result-group-count'
    count.textContent = `${rows.length}件`

    toggle.appendChild(label)
    toggle.appendChild(count)

    const list = document.createElement('div')
    list.className = 'result-group-list'
    list.id = listId

    for (const row of rows) {
      list.appendChild(createResultCard(row))
    }

    toggle.addEventListener('click', () => {
      const isOpen = !list.hidden
      list.hidden = isOpen
      toggle.setAttribute('aria-expanded', String(!isOpen))
      updateToggleAllLabel()
    })
    toggles.push({ toggle, list })

    header.appendChild(toggle)
    groupSection.appendChild(header)
    groupSection.appendChild(list)
    fragment.appendChild(groupSection)

    const navButton = document.createElement('button')
    navButton.type = 'button'
    navButton.className = 'result-nav-button'
    navButton.textContent = `${group.label} ${rows.length}`
    navButton.addEventListener('click', () => {
      list.hidden = false
      toggle.setAttribute('aria-expanded', 'true')
      groupSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    nav.appendChild(navButton)
  }

  if (nav.childElementCount > 0) {
    const total = groups.reduce((sum, group) => sum + results[group.key].length, 0)
    const totalChip = document.createElement('div')
    totalChip.className = 'result-nav-total'
    totalChip.textContent = `計 ${total}`

    toggleAll = document.createElement('button')
    toggleAll.type = 'button'
    toggleAll.className = 'result-nav-button'
    toggleAll.addEventListener('click', () => {
      const anyClosed = toggles.some(({ list }) => list.hidden)
      for (const { list, toggle } of toggles) {
        list.hidden = !anyClosed
        toggle.setAttribute('aria-expanded', String(anyClosed))
      }
      updateToggleAllLabel()
    })

    nav.appendChild(totalChip)
    if (toggles.length > 0) {
      updateToggleAllLabel()
      nav.appendChild(toggleAll)
    }
    fragment.prepend(nav)
  }

  resultsContainer.appendChild(fragment)
}

function createResultCard(row: EntryRow): HTMLAnchorElement {
  const card = document.createElement('a')
  card.className = 'result-card'
  card.href = `${GAIJI_BASE_URL}${row.href}`
  card.target = '_blank'
  card.rel = 'noopener noreferrer'

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
  return card
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
