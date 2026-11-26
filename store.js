// 本地存储：每天一份榜单快照，飙升榜靠前后两天的名次差算出来。
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_COUNTRIES = ['us', 'jp', 'kr', 'de', 'gb', 'in', 'cn']
export const CHARTS = ['free', 'paid', 'grossing']

export function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value))
  fs.renameSync(temp, file)
}

const SAFE = /^[a-z0-9_-]+$/i

export class Store {
  constructor(root) {
    this.root = root
    this.dataDir = path.join(root, 'data')
  }

  snapshotFile(store, country, chart, date) {
    return path.join(this.dataDir, 'snapshots', store, country, chart, `${date}.json`)
  }

  configFile() {
    return path.join(this.dataDir, 'config.json')
  }

  config() {
    const saved = readJson(this.configFile(), null)
    const countries = Array.isArray(saved?.countries) ? saved.countries.filter((item) => typeof item === 'string') : []
    return {
      countries: countries.length ? countries : DEFAULT_COUNTRIES.slice(),
      updatedAt: saved?.updatedAt || '',
    }
  }

  saveConfig(patch) {
    const next = { ...this.config(), ...patch }
    next.countries = Array.isArray(next.countries) && next.countries.length ? next.countries : DEFAULT_COUNTRIES.slice()
    next.updatedAt = new Date().toISOString()
    writeJsonAtomic(this.configFile(), next)
    return next
  }

  saveSnapshot({ store, country, chart, date, apps }) {
    if (!SAFE.test(store) || !SAFE.test(country) || !SAFE.test(chart)) throw new Error('非法的快照标识')
    const snapshot = {
      store,
      country,
      chart,
      date,
      fetchedAt: new Date().toISOString(),
      count: apps.length,
      apps,
    }
    writeJsonAtomic(this.snapshotFile(store, country, chart, date), snapshot)
    return snapshot
  }

  readSnapshot(store, country, chart, date) {
    return readJson(this.snapshotFile(store, country, chart, date), null)
  }

  /** 某国家某榜单已有的所有快照日期，升序。 */
  dates(store, country, chart) {
    const dir = path.dirname(this.snapshotFile(store, country, chart, 'x'))
    try {
      return fs.readdirSync(dir)
        .map((name) => name.replace(/\.json$/, ''))
        .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
        .sort()
    } catch {
      return []
    }
  }

  /** 最新一份快照，可限定日期之前。 */
  latest(store, country, chart, before) {
    const dates = this.dates(store, country, chart).filter((date) => !before || date < before)
    for (let index = dates.length - 1; index >= 0; index--) {
      const snapshot = this.readSnapshot(store, country, chart, dates[index])
      if (snapshot) return snapshot
    }
    return null
  }

  /**
   * 飙升榜：今天 vs 最近一份更早的快照。
   * delta 为正表示名次上升的位数；新进榜的标记 isNew。
   */
  rising({ store, country, chart, date, limit = 50 }) {
    const current = (date && this.readSnapshot(store, country, chart, date)) || this.latest(store, country, chart)
    if (!current) return { ready: false, reason: 'empty', apps: [] }
    const previous = this.latest(store, country, chart, current.date)
    if (!previous) return { ready: false, reason: 'baseline', date: current.date, fetchedAt: current.fetchedAt, apps: [] }

    const previousRank = new Map()
    for (const app of previous.apps || []) previousRank.set(app.id, app.rank)

    const movers = []
    for (const app of current.apps || []) {
      const prevRank = previousRank.get(app.id)
      const delta = typeof prevRank === 'number' ? prevRank - app.rank : null
      if (delta === null) {
        movers.push({ ...app, prevRank: null, delta: null, isNew: true })
      } else if (delta !== 0) {
        movers.push({ ...app, prevRank, delta, isNew: false })
      }
    }
    movers.sort((a, b) => {
      if (a.delta === null && b.delta === null) return a.rank - b.rank
      if (a.delta === null) return 1
      if (b.delta === null) return -1
      if (b.delta !== a.delta) return b.delta - a.delta
      return a.rank - b.rank
    })
    return {
      ready: true,
      date: current.date,
      fetchedAt: current.fetchedAt,
      previousDate: previous.date,
      total: movers.length,
      apps: movers.slice(0, limit),
    }
  }

  descriptionFile(store, country, id) {
    const safeId = String(id).replace(/[^a-zA-Z0-9_.-]/g, '_')
    return path.join(this.dataDir, 'descriptions', store, country, `${safeId}.json`)
  }

  appendLog(line) {
    const file = path.join(this.dataDir, 'client.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, line)
  }

  summaryCacheFile() {
    return path.join(this.dataDir, 'summary-zh.json')
  }

  readSummaryCache() {
    const saved = readJson(this.summaryCacheFile(), null)
    return saved && typeof saved === 'object' ? saved : {}
  }

  saveSummaryCache(cache) {
    writeJsonAtomic(this.summaryCacheFile(), cache)
    return cache
  }

  readDescription(store, country, id, maxAgeMs = 7 * 24 * 3600 * 1000) {
    const file = this.descriptionFile(store, country, id)
    const saved = readJson(file, null)
    if (!saved || !saved.fetchedAt) return null
    if (Date.now() - Date.parse(saved.fetchedAt) > maxAgeMs) return null
    return saved
  }

  saveDescription(store, country, id, value) {
    const record = { ...value, fetchedAt: new Date().toISOString() }
    writeJsonAtomic(this.descriptionFile(store, country, id), record)
    return record
  }

  status() {
    const countries = this.config().countries
    const rows = []
    for (const country of countries) {
      for (const chart of CHARTS) rows.push({ store: 'apple', country, chart, dates: this.dates('apple', country, chart) })
      rows.push({ store: 'google', country, chart: 'free', dates: this.dates('google', country, 'free') })
    }
    return { countries, rows }
  }
}
