// 谷歌 Play：官方没有公开榜单接口，这里只取网页端能看到的榜单（约 25 条），
// 以及详情页里的介绍正文。页面结构变了会拿不到数据，需要跟着修。
import { request, decodeEntities, htmlToText } from './http.js'

const TOP_URL = (country) => `https://play.google.com/store/apps/top?hl=en&gl=${String(country || 'us').toUpperCase()}`
const GAME_URL = (country) => `https://play.google.com/store/apps/category/GAME?hl=en&gl=${String(country || 'us').toUpperCase()}`
const DETAIL_URL = (country, id) =>
  `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=en&gl=${String(country || 'us').toUpperCase()}`

const ANCHOR = /<a class="Si6A0c[^"]*" href="\/store\/apps\/details\?id=([A-Za-z0-9_.]+)"/g

function pickTitle(slice) {
  const alt = slice.match(/alt="Icon image ([^"]+)"/)
  if (alt) return decodeEntities(alt[1])
  const title = slice.match(/<div[^>]+title="([^"]+)"/)
  if (title) return decodeEntities(title[1])
  const text = slice.match(/<div class="Epkrse[^"]*">([^<]+)<\/div>/)
  return text ? decodeEntities(text[1]) : ''
}

function pickIcon(slice) {
  const match = slice.match(/<img[^>]+src="(https:\/\/play-lh\.googleusercontent\.com[^"]+)"/)
  return match ? match[1].replace(/=s\d+.*$/, '=s128') : ''
}

/** 网页可见的谷歌榜单（约 20 条，上限 50）；games_free 走游戏分类页。 */
export async function fetchPlayChart({ country, chart = 'free', limit = 50 }) {
  const res = await request(chart === 'games_free' ? GAME_URL(country) : TOP_URL(country))
  const html = res.body
  const anchors = [...html.matchAll(ANCHOR)]
  const apps = []
  const seen = new Set()
  for (let index = 0; index < anchors.length && apps.length < limit; index++) {
    const id = anchors[index][1]
    if (seen.has(id)) break // 第一条重复说明榜单结束，后面是推荐位
    seen.add(id)
    const start = anchors[index].index
    const end = index + 1 < anchors.length ? anchors[index + 1].index : Math.min(html.length, start + 6000)
    const slice = html.slice(start, end)
    apps.push({
      id,
      name: pickTitle(slice) || id,
      developer: '',
      icon: pickIcon(slice),
      url: `https://play.google.com/store/apps/details?id=${id}`,
      category: '',
      releaseDate: '',
      rank: apps.length + 1,
    })
  }
  if (!apps.length) throw new Error('谷歌榜单页结构已经变化，暂时取不到数据')
  return apps
}

/** 谷歌 App 详情：介绍正文 + 名称 + 图标。 */
export async function fetchPlayApp({ country, id }) {
  const res = await request(DETAIL_URL(country, id))
  const html = res.body
  const titleMatch = html.match(/<title id="main-title">([^<]+?)(?: - Apps on Google Play)?<\/title>/)
  const name = titleMatch ? decodeEntities(titleMatch[1]) : id
  const descMatch = html.match(/data-g-id="description"[^>]*>([\s\S]*?)<\/div>/)
  const description = descMatch ? htmlToText(descMatch[1]) : ''
  const iconMatch = html.match(/<meta property="og:image" content="([^"]+)"/)
  const shortMatch = html.match(/<meta itemprop="description" content="([^"]*)"/)
  if (!name && !description) throw new Error('谷歌详情页结构已经变化，暂时取不到介绍')
  return {
    id,
    name,
    developer: '',
    icon: iconMatch ? decodeEntities(iconMatch[1]) : '',
    url: `https://play.google.com/store/apps/details?id=${id}`,
    category: '',
    rating: 0,
    ratingCount: 0,
    releaseDate: '',
    price: '',
    tagline: shortMatch ? decodeEntities(shortMatch[1]) : '',
    description,
  }
}

/** 一句话简介：详情页里的 meta 描述，通常就是官方的短介绍。 */
export async function fetchPlaySummary({ country, id }) {
  const res = await request(DETAIL_URL(country, id))
  const match = res.body.match(/<meta itemprop="description" content="([^"]*)"/)
  return match ? decodeEntities(match[1]).trim() : ''
}
