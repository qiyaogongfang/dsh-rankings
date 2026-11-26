// 苹果 App Store：官方免费榜单接口 + lookup 取介绍。
import { request, requestJson } from './http.js'

const CHARTS = {
  free: 'top-free',
  paid: 'top-paid',
}

const GAME_GENRE = '6014'

function marketingUrl(country, chart, limit) {
  return `https://rss.marketingtools.apple.com/api/v2/${country}/apps/${CHARTS[chart]}/${limit}/apps.json`
}

function legacyUrl(country, kind, limit, genre) {
  const base = `https://itunes.apple.com/${country}/rss/${kind}/limit=${limit}/json`
  return genre ? `${base.replace(/\/json$/, `/genre=${genre}/json`)}` : base
}

function grossingUrl(country, limit, genre) {
  return legacyUrl(country, 'topgrossingapplications', limit, genre)
}

function fromMarketing(item, rank) {
  return {
    id: String(item.id),
    name: item.name || item.id,
    developer: item.artistName || '',
    icon: item.artworkUrl100 || '',
    url: item.url || '',
    category: Array.isArray(item.genres) && item.genres.length ? item.genres[0] : '',
    releaseDate: item.releaseDate || '',
    rank,
  }
}

function fromLegacy(entry, rank) {
  const images = entry['im:image'] || []
  const last = images[images.length - 1] || {}
  return {
    id: String(entry.id?.attributes?.['im:id'] || ''),
    name: entry['im:name']?.label || '',
    developer: entry['im:artist']?.label || '',
    icon: last.label || '',
    url: entry.link?.[0]?.attributes?.href || '',
    category: entry.category?.attributes?.label || '',
    releaseDate: entry['im:releaseDate']?.attributes?.label || '',
    rank,
  }
}

/** 免费 / 付费 / 收入榜，按国家取前 limit 名（免费源最多给 100 条）。 */
export async function fetchAppleChart({ country, chart = 'free', limit = 100 }) {
  const code = String(country || 'us').toLowerCase()
  // 苹果这个接口对 limit=50 会稳定返回 502，统一取 100（上限），要更多也没有。
  const fetchCount = 100
  const isGames = chart.startsWith('games_')
  const kind = isGames ? chart.slice('games_'.length) : chart
  const legacyKind = kind === 'free' ? 'topfreeapplications' : kind === 'paid' ? 'toppaidapplications' : kind === 'grossing' ? 'topgrossingapplications' : ''
  if (!legacyKind) throw new Error(`未知榜单：${chart}`)
  if (isGames || kind === 'grossing' || !CHARTS[kind]) {
    const payload = await requestJson(legacyUrl(code, legacyKind, fetchCount, isGames ? GAME_GENRE : ''))
    const entries = payload.feed?.entry || []
    return entries.slice(0, limit).map((entry, index) => fromLegacy(entry, index + 1))
  }
  try {
    const payload = await requestJson(marketingUrl(code, kind, fetchCount))
    const results = payload.feed?.results || []
    if (results.length) return results.slice(0, limit).map((item, index) => fromMarketing(item, index + 1))
  } catch (error) {
    console.error(`[rankings] 新接口失败，退回旧 RSS：${error.message}`)
  }
  const payload = await requestJson(legacyUrl(code, legacyKind, fetchCount))
  const entries = payload.feed?.entry || []
  return entries.slice(0, limit).map((entry, index) => fromLegacy(entry, index + 1))
}

/** 单个 App 的详细介绍（描述、分类、评分、上架日）。 */
export async function fetchAppleApp({ country, id }) {
  const code = String(country || 'us').toLowerCase()
  const payload = await requestJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=${code}`)
  const item = (payload.results || [])[0]
  if (!item) throw new Error('苹果商店里没有找到这个 App')
  return {
    id: String(item.trackId || id),
    name: item.trackName || '',
    developer: item.artistName || '',
    icon: item.artworkUrl512 || item.artworkUrl100 || '',
    url: item.trackViewUrl || '',
    category: (item.genres || [])[0] || '',
    rating: item.averageUserRating || 0,
    ratingCount: item.userRatingCount || 0,
    releaseDate: item.releaseDate || '',
    version: item.version || '',
    price: item.formattedPrice || '',
    description: item.description || '',
  }
}

/** 一句话概括：取描述里的第一句，压到 90 字以内。 */
export function firstSentence(text) {
  const clean = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return ''
  const stop = clean.search(/[。！？.!?]\s|[。！？]/)
  const head = stop > 10 ? clean.slice(0, stop + 1) : clean.slice(0, 90)
  return head.length > 90 ? `${head.slice(0, 88).trimEnd()}…` : head
}

/** 批量拿简介（lookup 支持一次多个 id），返回 id → 一句话。 */
export async function fetchAppleSummaries({ country, ids }) {
  const code = String(country || 'us').toLowerCase()
  const list = (ids || []).filter(Boolean).slice(0, 60)
  if (!list.length) return {}
  const payload = await requestJson(`https://itunes.apple.com/lookup?id=${list.join(',')}&country=${code}`)
  const map = {}
  for (const item of payload.results || []) {
    map[String(item.trackId)] = firstSentence(item.description)
  }
  return map
}

export { request }
