// 本地存储：每天一份榜单快照，飙升榜靠前后两天的名次差算出来。
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_COUNTRIES = ['us', 'jp', 'kr', 'de', 'gb', 'in', 'cn', 'fr', 'ca', 'au', 'br', 'id', 'th', 'vn', 'tw', 'hk', 'sg']
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

  workerFile() {
    return path.join(this.dataDir, 'worker.json')
  }

  worker() {
    const saved = readJson(this.workerFile(), null)
    if (!saved || !saved.url) return null
    return {
      url: String(saved.url).replace(/\/+$/, ''),
      key: String(saved.key || ''),
      enabled: saved.enabled !== false,
    }
  }

  reviewsQueueFile() {
    return path.join(this.dataDir, 'reviews-queue.json')
  }

  readReviewsQueue() {
    const saved = readJson(this.reviewsQueueFile(), null)
    return Array.isArray(saved) ? saved : []
  }

  saveReviewsQueue(queue) {
    writeJsonAtomic(this.reviewsQueueFile(), queue.slice(0, 500))
    return queue
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

  /**
   * 周榜 / 月榜：按窗口内每天的榜单快照聚合。
   * 排序看平均名次（名次越靠前越优先），同分看上榜天数。
   */
  aggregate({ store, country, chart, days = 7, date, limit = 100 }) {
    const today = date || localDate()
    const all = this.dates(store, country, chart).filter((item) => item <= today)
    const window = all.slice(-days)
    if (!window.length) return { ready: false, reason: 'empty', apps: [] }
    const acc = new Map()
    for (const day of window) {
      const snapshot = this.readSnapshot(store, country, chart, day)
      if (!snapshot) continue
      for (const app of snapshot.apps || []) {
        const row = acc.get(app.id) || {
          id: app.id,
          name: app.name,
          developer: app.developer || '',
          icon: app.icon || '',
          url: app.url || '',
          days: 0,
          sumRank: 0,
          best: Infinity,
          lastRank: null,
          lastDate: '',
        }
        row.days += 1
        row.sumRank += app.rank
        row.best = Math.min(row.best, app.rank)
        if (day >= row.lastDate) {
          row.lastDate = day
          row.lastRank = app.rank
        }
        if (app.summaryZh) row.summaryZh = app.summaryZh
        else if (app.summary) row.summary = app.summary
        acc.set(app.id, row)
      }
    }
    const apps = [...acc.values()]
      .map((row) => ({ ...row, avgRank: row.sumRank / row.days }))
      .sort((a, b) => a.avgRank - b.avgRank || b.days - a.days)
      .slice(0, limit)
      .map((row, index) => ({
        ...row,
        rank: index + 1,
        avgRank: Math.round(row.avgRank * 10) / 10,
        best: Number.isFinite(row.best) ? row.best : null,
      }))
    return {
      ready: true,
      store,
      country,
      chart,
      date: today,
      days: window.length,
      start: window[0],
      end: window[window.length - 1],
      apps,
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
