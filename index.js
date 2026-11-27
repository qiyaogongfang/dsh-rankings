// 排行榜 · Host 半边
//
// 1. 苹果：官方免费榜单接口（免费 / 付费 / 收入），lookup 取介绍。
// 2. 谷歌：网页端可见的免费榜（约 25 条）+ 详情页抓介绍；没有官方接口。
// 3. 每天存一份快照，名次差算「飙升榜」；数据在 data/snapshots 下，纯 JSON。
import { fileURLToPath } from 'node:url'
import { Store, localDate, DEFAULT_COUNTRIES } from './store.js'
import { fetchAppleChart, fetchAppleApp, fetchAppleSummaries, fetchAppleReviews } from './fetch-apple.js'
import { fetchPlayChart, fetchPlayApp, fetchPlaySummary } from './fetch-play.js'
import { translateLines } from './translate.js'
import { request } from './http.js'

const PLUGIN_ROOT = fileURLToPath(new URL('.', import.meta.url))
const BASE = '/rankings/api'
const MAX_BODY = 256 * 1024
const SNAPSHOT_LIMIT = 100
const FRESH_MS = 6 * 3600 * 1000

export const name = 'rankings'
export const inject = ['webServer', 'tools']

const CHART_LABEL = {
  free: '免费榜',
  paid: '付费榜',
  grossing: '收入榜',
  games_free: '游戏免费榜',
  games_paid: '游戏付费榜',
  games_grossing: '游戏收入榜',
}
const APPLE_CHARTS = ['free', 'paid', 'grossing', 'games_free', 'games_paid', 'games_grossing']
const GOOGLE_CHARTS = ['free', 'games_free']

function chartFor(store, raw) {
  const list = store === 'google' ? GOOGLE_CHARTS : APPLE_CHARTS
  return list.includes(raw) ? raw : list[0]
}
const STORE_LABEL = { apple: '苹果 App Store', google: '谷歌 Play' }

const text = (value) => [{ type: 'text', text: value }]

function statusError(status, message) {
  return Object.assign(new Error(message), { status })
}

function labelChart(chart) {
  return CHART_LABEL[chart] || chart
}

function labelStore(store) {
  return STORE_LABEL[store] || store
}

async function fetchChart({ store, country, chart }) {
  if (store === 'google') {
    if (String(country).toLowerCase() === 'cn') throw new Error('谷歌商店在中国大陆不可用')
    return fetchPlayChart({ country, chart, limit: SNAPSHOT_LIMIT })
  }
  return fetchAppleChart({ country, chart, limit: SNAPSHOT_LIMIT })
}

async function fetchApp({ store, country, id }) {
  if (store === 'google') return fetchPlayApp({ country, id })
  return fetchAppleApp({ country, id })
}

/** 浏览器页面和工具共用的同一套操作。 */
async function dispatch(ctx, action, payload) {
  switch (action) {
    case 'settings':
      return { ...ctx.store.config(), charts: ctx.store.status() }
    case 'top': {
      const store = payload.store === 'google' ? 'google' : 'apple'
      const country = String(payload.country || 'us').toLowerCase()
      const chart = chartFor(store, payload.chart)
      const saved = ctx.store.latest(store, country, chart)
      const fresh = saved && Date.now() - Date.parse(saved.fetchedAt) < FRESH_MS
      if (saved && fresh && !payload.force) {
        let added = 0
        try {
          added = await withTimeout(enrichAll(ctx, { store, country, chart, apps: saved.apps }, prewarming ? 'cache-only' : 'ui'), 45000)
        } catch (error) {
          console.error(`[rankings] 补简介跳过: ${error.message}`)
        }
        if (added) {
          const snapshot = ctx.store.saveSnapshot({ store, country, chart, date: saved.date, apps: saved.apps })
          pushSnapshot(ctx, snapshot).catch(() => {})
          return { ...snapshot, cached: true }
        }
        return { ...saved, cached: true }
      }
      const apps = await fetchChart({ store, country, chart })
      try {
        await withTimeout(enrichAll(ctx, { store, country, chart, apps }, prewarming ? 'cache-only' : 'ui'), 45000)
      } catch (error) {
        console.error(`[rankings] 补简介跳过: ${error.message}`)
      }
      const snapshot = ctx.store.saveSnapshot({ store, country, chart, date: localDate(), apps })
      pushSnapshot(ctx, snapshot).catch(() => {})
      return { ...snapshot, cached: false }
    }
    case 'rising': {
      const store = payload.store === 'google' ? 'google' : 'apple'
      const country = String(payload.country || 'us').toLowerCase()
      const chart = chartFor(store, payload.chart)
      return ctx.store.rising({ store, country, chart, limit: SNAPSHOT_LIMIT })
    }
    case 'weekly':
    case 'monthly': {
      const store = payload.store === 'google' ? 'google' : 'apple'
      const country = String(payload.country || 'us').toLowerCase()
      const chart = chartFor(store, payload.chart)
      return ctx.store.aggregate({
        store,
        country,
        chart,
        days: action === 'weekly' ? 7 : 30,
        limit: SNAPSHOT_LIMIT,
      })
    }
    case 'app': {
      const store = payload.store === 'google' ? 'google' : 'apple'
      const country = String(payload.country || 'us').toLowerCase()
      const id = String(payload.id || '')
      if (!id) throw new Error('缺少 id')
      return describeApp(ctx, { store, country, id })
    }
    case 'log': {
      // 浏览器半边的报错回传，方便排查白屏
      const line = `${new Date().toISOString()} ${String(payload.message || '').slice(0, 4000)}\n`
      try {
        ctx.store.appendLog(line)
      } catch {}
      return { ok: true }
    }
    case 'prewarm':
      return prewarm(ctx, '手动')
    case 'push':
      return pushToday(ctx)
    default:
      throw statusError(400, `未知操作：${action}`)
  }
}

async function describeApp(ctx, { store, country, id }) {
  const cached = ctx.store.readDescription(store, country, id)
  if (cached) return cached
  const value = await fetchApp({ store, country, id })
  return ctx.store.saveDescription(store, country, id, value)
}

async function mapLimit(items, limit, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      try {
        await worker(items[index])
      } catch {}
    }
  })
  await Promise.all(runners)
}

/** 补简介最多等这么久，超时先用已拿到的，下次再补。 */
function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('补简介超时')), ms)
    if (timer.unref) timer.unref()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 给每条榜单补一句话简介。
 * 苹果：lookup 支持一次查多个 id，一次请求拿全榜。
 * 谷歌：没有批量接口，逐个取详情页的 meta 描述，并发 4，结果进缓存。
 */
async function enrichSummaries(ctx, { store, country, chart, apps }) {
  const missing = apps.filter((app) => !app.summary)
  if (!missing.length) return 0
  let added = 0
  if (store === 'apple') {
    const ids = missing.map((app) => app.id).filter(Boolean)
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50)
      try {
        const map = await fetchAppleSummaries({ country, ids: chunk })
        for (const app of missing) {
          if (!app.summary && map[app.id]) {
            app.summary = map[app.id]
            added++
          }
        }
      } catch (error) {
        console.error(`[rankings] 苹果简介失败: ${error.message}`)
      }
    }
    return added
  }
  await mapLimit(missing, 6, async (app) => {
    const saved = ctx.store.readDescription(store, country, app.id)
    if (saved && saved.tagline) {
      app.summary = saved.tagline
      added++
      return
    }
    const text = await fetchPlaySummary({ country, id: app.id })
    if (text) {
      app.summary = text
      added++
      ctx.store.saveDescription(store, country, app.id, {
        ...(saved || {}),
        id: app.id,
        name: (saved && saved.name) || app.name,
        tagline: text,
        description: (saved && saved.description) || '',
      })
    }
  })
  return added
}

const HAN = /[\u4e00-\u9fff]/
const KANA_HANGUL = /[\u3040-\u30ff\uac00-\ud7af]/

/** 判断一句简介是否真的是中文（含汉字，且没有假名/谚文）。 */
function looksChinese(text) {
  return Boolean(text) && HAN.test(text) && !KANA_HANGUL.test(text)
}

/** 翻译一批（每批 15 条，一次调用）；没翻成的逐条重试，确保都出中文。 */
async function translateQueue(ctx, apps, chunkSize = 15) {
  if (!apps.length) return 0
  const cache = ctx.store.readSummaryCache()
  let updated = 0
  let changed = false
  const chunks = []
  for (let index = 0; index < apps.length; index += chunkSize) chunks.push(apps.slice(index, index + chunkSize))
  for (const chunk of chunks) {
    let zh = []
    try {
      zh = await translateLines(chunk.map((app) => app.summary))
    } catch (error) {
      console.error(`[rankings] 整批翻译失败: ${error.message}`)
      zh = []
    }
    for (let index = 0; index < chunk.length; index++) {
      const app = chunk[index]
      let text = zh[index]
      // 单条兜底：空、原样返回、或残留日文/韩文，就单独再翻两次
      for (let attempt = 0; attempt < 2 && !looksChinese(text); attempt++) {
        try {
          const one = await translateLines([app.summary])
          text = one[0]
        } catch {
          text = ''
        }
      }
      if (!looksChinese(text)) continue
      app.summaryZh = text
      cache[app.id] = { en: app.summary, zh: text }
      changed = true
      updated++
    }
    if (changed) ctx.store.saveSummaryCache(cache)
  }
  return updated
}

/**
 * 把英文简介翻成中文（本机 Ollama，关了就保持英文）。
 * syncLimit：先同步翻前几条（面板马上要看的），其余丢后台继续翻、结果进缓存。
 */
async function localizeSummaries(ctx, apps, { syncLimit = 0, applyOnly = false, chunkSize = 15 } = {}) {
  const cache = ctx.store.readSummaryCache()
  let updated = 0
  const queue = []
  for (const app of apps) {
    if (!app.summary || app.summaryZh) continue
    if (looksChinese(app.summary)) {
      // 本来就是中文（比如中国区商店），不需要翻
      app.summaryZh = app.summary
      updated++
      continue
    }
    const saved = cache[app.id]
    if (saved && saved.en === app.summary && looksChinese(saved.zh)) {
      app.summaryZh = saved.zh
      updated++
    } else {
      queue.push(app)
    }
  }
  if (applyOnly || !queue.length) return updated
  const syncPart = syncLimit > 0 ? queue.slice(0, syncLimit) : queue
  const rest = syncLimit > 0 ? queue.slice(syncLimit) : []
  updated += await translateQueue(ctx, syncPart, chunkSize)
  if (rest.length) {
    setTimeout(() => {
      translateQueue(ctx, rest, chunkSize).catch(() => {})
    }, 50)
  }
  return updated
}

/**
 * 补简介 + 翻中文，返回新增数量。
 * mode：ui = 翻前 12 条、其余后台；prewarm = 全部翻完（预缓存串行用）；cache-only = 只读缓存。
 */
async function enrichAll(ctx, { store, country, chart, apps }, mode = 'ui') {
  const added = await enrichSummaries(ctx, { store, country, chart, apps })
  if (mode === 'cache-only') return added + await localizeSummaries(ctx, apps, { applyOnly: true })
  if (mode === 'prewarm') return added + await localizeSummaries(ctx, apps, { chunkSize: 50 })
  return added + await localizeSummaries(ctx, apps, { syncLimit: 12 })
}

/** 把快照推到云端 Worker（data/worker.json 配置了才推）。 */
async function pushSnapshot(ctx, snapshot) {
  const worker = ctx.store.worker()
  if (!worker || !worker.enabled) return false
  try {
    const res = await request(`${worker.url}/api/ingest?key=${encodeURIComponent(worker.key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        store: snapshot.store,
        country: snapshot.country,
        chart: snapshot.chart,
        day: snapshot.date,
        apps: snapshot.apps,
      }),
      timeout: 20000,
    })
    if (res.status >= 200 && res.status < 300) {
      enqueueReviews(ctx, snapshot).catch(() => {})
      return true
    }
    return false
  } catch (error) {
    console.error(`[rankings] 推送云端失败 ${snapshot.store}/${snapshot.country}/${snapshot.chart}: ${error.message}`)
    return false
  }
}

/** 把今天所有快照推一遍（手动或定时补齐用）。 */
async function pushToday(ctx) {
  const worker = ctx.store.worker()
  if (!worker) return { pushed: 0, failed: 0, skipped: true }
  const { countries } = ctx.store.config()
  const today = localDate()
  let pushed = 0
  let failed = 0
  for (const country of countries) {
    const charts = APPLE_CHARTS
    for (const chart of charts) {
      const snapshot = ctx.store.readSnapshot('apple', country, chart, today)
      if (snapshot && (await pushSnapshot(ctx, snapshot))) pushed++
      else if (snapshot) failed++
    }
    if (country !== 'cn') {
      for (const chart of GOOGLE_CHARTS) {
        const snapshot = ctx.store.readSnapshot('google', country, chart, today)
        if (snapshot && (await pushSnapshot(ctx, snapshot))) pushed++
        else if (snapshot) failed++
      }
    }
  }
  return { pushed, failed, skipped: false }
}

/** 把榜单前排 App 排进评论队列（只处理苹果，队列串行慢慢补全）。 */
async function enqueueReviews(ctx, snapshot) {
  if (snapshot.store !== 'apple') return
  const worker = ctx.store.worker()
  if (!worker || !worker.enabled) return
  const queue = ctx.store.readReviewsQueue()
  const known = new Set(queue.map((item) => `${item.country}:${item.id}`))
  for (const app of snapshot.apps.slice(0, 10)) {
    const key = `${snapshot.country}:${app.id}`
    if (known.has(key)) continue
    known.add(key)
    queue.push({ store: 'apple', country: snapshot.country, id: app.id, name: app.name })
  }
  ctx.store.saveReviewsQueue(queue)
}

/** 队列串行处理：一次取一条，抓评论推云端，成功失败都出队。 */
async function processReviewsQueue(ctx) {
  const worker = ctx.store.worker()
  if (!worker || !worker.enabled) return
  const queue = ctx.store.readReviewsQueue()
  if (!queue.length) return
  const item = queue[0]
  try {
    const reviews = await fetchAppleReviews({ country: item.country, id: item.id })
    if (reviews.length) {
      await request(`${worker.url}/api/reviews/ingest?key=${encodeURIComponent(worker.key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store: 'apple', country: item.country, id: item.id, reviews }),
        timeout: 20000,
      })
      console.log(`[rankings] 评论已推送 ${item.country}/${item.id}（${reviews.length} 条）`)
    }
  } catch (error) {
    console.error(`[rankings] 评论推送失败 ${item.country}/${item.id}: ${error.message}`)
  }
  ctx.store.saveReviewsQueue(queue.slice(1))
}

function formatRankLine(app) {
  const bits = [`${app.rank}. ${app.name}`]
  if (app.developer) bits.push(`by ${app.developer}`)
  if (app.isNew) bits.push('新进榜')
  else if (typeof app.delta === 'number' && app.delta > 0) bits.push(`↑${app.delta}`)
  else if (typeof app.delta === 'number' && app.delta < 0) bits.push(`↓${Math.abs(app.delta)}`)
  return bits.join(' · ')
}

function listText(snapshot) {
  const lines = [
    `${labelStore(snapshot.store)} · ${labelChart(snapshot.chart)} · ${String(snapshot.country).toUpperCase()} · 前 ${snapshot.apps.length} 名`,
    `快照时间：${snapshot.fetchedAt}`,
    '',
  ]
  for (const app of snapshot.apps) lines.push(formatRankLine(app))
  return lines.join('\n')
}

function risingText(rising) {
  if (!rising.ready) {
    if (rising.reason === 'baseline') return `还没有足够的快照：今天（${rising.date}）是基线，明天同一时间之后才有飙升榜。`
    return '这个国家/榜单还没有快照，先在面板里打开一次。'
  }
  const lines = [
    `飙升榜 · ${rising.date}（对比 ${rising.previousDate}）· 共 ${rising.total} 款有变化`,
    '',
  ]
  for (const app of rising.apps) {
    const sign = app.isNew ? '新进榜' : `↑${app.delta} 位（原第 ${app.prevRank} 名）`
    lines.push(`${app.rank}. ${app.name} — ${sign}`)
  }
  return lines.join('\n')
}

function appText(app) {
  const lines = [`${app.name}${app.developer ? ` · ${app.developer}` : ''}`]
  if (app.category) lines.push(`分类：${app.category}`)
  if (app.rating) lines.push(`评分：${Number(app.rating).toFixed(1)}（${app.ratingCount} 人评价）`)
  if (app.releaseDate) lines.push(`上架：${app.releaseDate}`)
  if (app.tagline) lines.push(`一句话：${app.tagline}`)
  lines.push('', app.description || '（没有取到介绍）')
  return lines.join('\n')
}

const params = (properties, required = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })

function buildTools(ctx) {
  return [
    {
      name: 'rank_top',
      description: '查应用商店排行榜（苹果前 100 名，谷歌约 20-40 条）。苹果支持免费/付费/收入榜和游戏三榜，谷歌有免费榜和游戏榜。',
      parameters: params({
        store: str('商店：apple 或 google', { enum: ['apple', 'google'] }),
        country: str('国家代码，如 us、jp、kr、de、gb、in、cn'),
        chart: str('榜单：free 免费 / paid 付费 / grossing 收入 / games_free 游戏免费 / games_paid 游戏付费 / games_grossing 游戏收入（谷歌只支持 free 和 games_free）', { enum: ['free', 'paid', 'grossing', 'games_free', 'games_paid', 'games_grossing'] }),
      }, ['store', 'country']),
      output: { schema: { type: 'string' }, render: (_args, value) => text(String(value)) },
      async execute(rawArgs) {
        const args = rawArgs || {}
        const result = await dispatch(ctx, 'top', {
          store: args.store || 'apple',
          country: args.country || 'us',
          chart: args.chart || 'free',
        })
        return listText(result)
      },
    },
    {
      name: 'rank_rising',
      description: '查今天对比上一次快照名次上升最快的 App（飙升榜）。需要至少两天的快照。',
      parameters: params({
        store: str('商店：apple 或 google', { enum: ['apple', 'google'] }),
        country: str('国家代码，如 us、jp'),
        chart: str('榜单：free / paid / grossing / games_free / games_paid / games_grossing', { enum: ['free', 'paid', 'grossing', 'games_free', 'games_paid', 'games_grossing'] }),
      }, ['store', 'country']),
      output: { schema: { type: 'string' }, render: (_args, value) => text(String(value)) },
      async execute(rawArgs) {
        const args = rawArgs || {}
        const result = await dispatch(ctx, 'rising', {
          store: args.store || 'apple',
          country: args.country || 'us',
          chart: args.chart || 'free',
        })
        return risingText(result)
      },
    },
    {
      name: 'rank_app',
      description: '查单个 App 的介绍（描述、分类、评分、上架日期）。',
      parameters: params({
        store: str('商店：apple 或 google', { enum: ['apple', 'google'] }),
        country: str('国家代码'),
        id: str('App 在商店里的 id：苹果是数字（如 6448311069），谷歌是包名（如 com.openai.chatgpt）'),
      }, ['store', 'country', 'id']),
      output: { schema: { type: 'string' }, render: (_args, value) => text(String(value)) },
      async execute(rawArgs) {
        const args = rawArgs || {}
        const result = await dispatch(ctx, 'app', {
          store: args.store || 'apple',
          country: args.country || 'us',
          id: args.id,
        })
        return appText(result)
      },
    },
  ]
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST') return reject(statusError(405, '只接受 POST'))
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return reject(statusError(415, 'content-type 必须是 application/json'))
    }
    if (req.headers['x-rankings'] !== '1') return reject(statusError(403, '缺少 x-rankings 请求头'))
    const origin = req.headers.origin
    if (origin) {
      let originHost = ''
      try {
        originHost = new URL(origin).host
      } catch {
        return reject(statusError(403, 'Origin 无效'))
      }
      if (!req.headers.host || originHost !== req.headers.host) return reject(statusError(403, '拒绝跨站请求'))
    }
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > max) req.destroy()
      else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(statusError(400, '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** 每天自动存快照，保证飙升榜有前一天的数据。 */
let prewarming = false

/**
 * 预缓存：把所有国家/榜单先抓一遍，顺手补简介、翻中文，之后面板打开就是本地读取。
 * 串行跑，避免把网络和本机模型一起打满；同一时间只跑一份。
 */
async function prewarm(ctx, reason) {
  if (prewarming) return { started: false, reason: 'already-running' }
  prewarming = true
  ;(async () => {
    try {
      const { countries } = ctx.store.config()
      const tasks = []
      const applePrewarm = ['free', 'paid', 'grossing', 'games_free', 'games_paid', 'games_grossing']
      for (const country of countries) {
        for (const chart of applePrewarm) tasks.push({ store: 'apple', country, chart })
        if (country !== 'cn') for (const chart of GOOGLE_CHARTS) tasks.push({ store: 'google', country, chart })
      }
      for (let round = 1; round <= 5; round++) {
        for (const task of tasks) {
          try {
            const saved = ctx.store.latest(task.store, task.country, task.chart)
            const fresh = saved && Date.now() - Date.parse(saved.fetchedAt) < FRESH_MS
            const apps = fresh ? saved.apps : await fetchChart(task)
            await enrichAll(ctx, { ...task, apps }, 'prewarm')
            const snapshot = ctx.store.saveSnapshot({ ...task, date: fresh ? saved.date : localDate(), apps })
            pushSnapshot(ctx, snapshot).catch(() => {})
          } catch (error) {
            console.error(`[rankings] 预缓存失败（第 ${round} 轮）${task.store}/${task.country}/${task.chart}: ${error.message}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
        let left = 0
        for (const task of tasks) {
          const snapshot = ctx.store.latest(task.store, task.country, task.chart)
          if (snapshot) left += (snapshot.apps || []).filter((app) => !looksChinese(app.summaryZh)).length
        }
        console.log(`[rankings] 预缓存第 ${round} 轮完成，剩余未翻 ${left} 条`)
        if (!left) break
      }
      let missing = 0
      for (const task of tasks) {
        const snapshot = ctx.store.latest(task.store, task.country, task.chart)
        if (snapshot) missing += (snapshot.apps || []).filter((app) => !looksChinese(app.summaryZh)).length
      }
      console.log(`[rankings] 预缓存完成（${reason}），未翻成中文 ${missing} 条`)
    } finally {
      prewarming = false
    }
  })()
  return { started: true }
}

function startDaily(ctx) {
  let stopped = false
  let timer = null
  let lastRun = ''

  async function runOnce(reason) {
    if (stopped) return
    const today = localDate()
    if (lastRun === today) return
    lastRun = today
    await prewarm(ctx, reason)
  }

  function schedule() {
    if (stopped) return
    const now = new Date()
    const target = new Date(now)
    target.setHours(8, 5, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    const wait = Math.min(target.getTime() - now.getTime(), 6 * 3600 * 1000)
    timer = setTimeout(async () => {
      if (stopped) return
      await runOnce('定时')
      schedule()
    }, Math.max(wait, 30_000))
    if (timer.unref) timer.unref()
  }

  // 启动后补一次今天的（如果 8 点过了还没存）
  const boot = setTimeout(() => { runOnce('启动补跑').catch(() => {}) }, 15_000)
  if (boot.unref) boot.unref()
  schedule()

  return () => {
    stopped = true
    clearTimeout(boot)
    if (timer) clearTimeout(timer)
  }
}

/**
 * DSH 准入检查：优先用 connection.requestRejection（Host/Origin 围栏 + 浏览器登录令牌），
 * 服务不可用时返回 false，退回 readJson 里的同源检查，避免任意网页调用本机接口。
 */
function guard(ctx, req, res) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : null
  if (!connection || typeof connection.requestRejection !== 'function') return false
  let rejection
  try {
    rejection = connection.requestRejection(req)
  } catch {
    rejection = 403
  }
  if (rejection === undefined) return false
  res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('forbidden')
  return true
}

export function apply(ctx) {
  const store = new Store(PLUGIN_ROOT)
  const state = { store }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      if (guard(ctx, req, res)) return
      try {
        const body = await readJson(req)
        const data = await dispatch(state, String(body.action || ''), body)
        sendJson(res, 200, { ok: true, data })
      } catch (error) {
        sendJson(res, error.status || 500, { ok: false, error: error.message })
      }
    },
  }))

  for (const tool of buildTools(state)) ctx.effect(() => ctx.tools.register(tool))

  ctx.effect(() => startDaily(state))

  ctx.effect(() => {
    const timer = setInterval(() => { processReviewsQueue(state).catch(() => {}) }, 30000)
    if (timer.unref) timer.unref()
    return () => clearInterval(timer)
  })

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({
      name: 'rankings',
      order: 62,
      text: [
        '这台机器上装了「软件排行榜」插件：侧栏可以看苹果 App Store 和谷歌 Play 的每日榜单、飙升榜和软件简介。',
        '用户问「最近什么 App 在涨」「某国榜单」「这个 App 怎么样」时，用 rank_top / rank_rising / rank_app 查，不要凭记忆回答。',
        `已配置的国家：${DEFAULT_COUNTRIES.join('、')}（以插件设置为准）。`,
      ].join('\n'),
    }))
  }
}
