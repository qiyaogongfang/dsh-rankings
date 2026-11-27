// 排行榜 · 浏览器半边
//
// 侧栏加一个「排行榜」图标，主区域：商店 / 榜单 / 国家三段筛选 + 列表；
// 点一款 App 右侧出介绍抽屉。数据来自 Host 的 POST /rankings/api（同源、自定义头）。
window.__ModuleLoader__.load({
  id: '@qiyaogongfang/dsh-rankings',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL = 'rankings'
    const API = '/rankings/api'

    const COUNTRIES = [
      { code: 'us', zh: '美国', en: 'United States' },
      { code: 'jp', zh: '日本', en: 'Japan' },
      { code: 'kr', zh: '韩国', en: 'Korea' },
      { code: 'de', zh: '德国', en: 'Germany' },
      { code: 'gb', zh: '英国', en: 'United Kingdom' },
      { code: 'in', zh: '印度', en: 'India' },
      { code: 'cn', zh: '中国', en: 'China' },
    ]

    const DICT = {
      zh: {
        panel: '软件排行榜',
        title: '软件排行榜',
        subtitle: (store, chart, country) => `${store} · ${chart} · ${country}`,
        storeApple: '苹果',
        storeGoogle: '谷歌',
        appleStore: 'App Store',
        googleStore: 'Google Play',
        chartFree: '免费榜',
        chartPaid: '付费榜',
        chartGrossing: '收入榜',
        chartGamesFree: '游戏免费榜',
        chartGamesPaid: '游戏付费榜',
        chartGamesGrossing: '游戏收入榜',
        catAll: '全部',
        catGames: '游戏',
        viewTop: '榜单',
        viewRising: '飙升',
        refresh: '刷新',
        refreshing: '刷新中…',
        prewarm: '预缓存',
        prewarmHint: '把所有国家和榜单先抓一遍、翻好中文，之后打开就不用等',
        updated: (value) => `更新于 ${value}`,
        cached: '缓存',
        emptyTop: '这个范围还没有数据',
        emptyTopHint: '点右上角「刷新」拉一次榜单。',
        emptyRising: '还看不出飙升',
        emptyRisingBaseline: '今天先存了基线，明天起才能算出名次变化。',
        emptyRisingHint: '这个国家/榜单还没有快照，先看一次「榜单」。',
        loadFail: '拉取失败',
        retry: '重试',
        loading: '正在取榜单',
        newBadge: '新进',
        up: (n) => `↑${n}`,
        down: (n) => `↓${n}`,
        same: '—',
        nobody: '点击左侧任一款 App，看它的介绍。',
        detailLoading: '正在取介绍',
        detailFail: '介绍没取到',
        openInStore: '在商店打开',
        showMore: '展开全文',
        showLess: '收起',
        brief: '简介',
        close: '关闭',
        category: '分类',
        rating: '评分',
        release: '上架',
        price: '价格',
        count: (n) => `${n} 款`,
        googleNote: '谷歌只取网页可见的免费榜（约 20 条），不是完整 Top 50。',
        cnGoogle: '谷歌商店在中国大陆不可用。',
        baselineTitle: '基线已存',
        baselineHint: '明天这个时间之后再打开，就有「昨日 → 今日」的名次变化。',
      },
      en: {
        panel: 'Software charts',
        title: 'Software charts',
        subtitle: (store, chart, country) => `${store} · ${chart} · ${country}`,
        storeApple: 'Apple',
        storeGoogle: 'Google',
        appleStore: 'App Store',
        googleStore: 'Google Play',
        chartFree: 'Free',
        chartPaid: 'Paid',
        chartGrossing: 'Grossing',
        chartGamesFree: 'Games free',
        chartGamesPaid: 'Games paid',
        chartGamesGrossing: 'Games grossing',
        catAll: 'All',
        catGames: 'Games',
        viewTop: 'Top',
        viewRising: 'Rising',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        prewarm: 'Pre-cache',
        prewarmHint: 'Fetch and translate every country and chart ahead of time so opening is instant',
        updated: (value) => `Updated ${value}`,
        cached: 'cached',
        emptyTop: 'Nothing here yet',
        emptyTopHint: 'Press “Refresh” to pull this chart.',
        emptyRising: 'No rising data yet',
        emptyRisingBaseline: 'Today is the baseline; rank changes appear from tomorrow on.',
        emptyRisingHint: 'No snapshot for this country/chart yet — open “Top” first.',
        loadFail: 'Failed to load',
        retry: 'Retry',
        loading: 'Loading chart',
        newBadge: 'NEW',
        up: (n) => `↑${n}`,
        down: (n) => `↓${n}`,
        same: '—',
        nobody: 'Pick an app on the left to see its description.',
        detailLoading: 'Loading description',
        detailFail: 'Could not load description',
        openInStore: 'Open in store',
        showMore: 'Show full text',
        showLess: 'Collapse',
        brief: 'Brief',
        close: 'Close',
        category: 'Category',
        rating: 'Rating',
        release: 'Released',
        price: 'Price',
        count: (n) => `${n} apps`,
        googleNote: 'Google shows only the web-visible free chart (~20 apps), not a full top 50.',
        cnGoogle: 'Google Play is not available in mainland China.',
        baselineTitle: 'Baseline saved',
        baselineHint: 'Come back after tomorrow to see yesterday → today rank changes.',
      },
    }

    let lang = /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
    const langListeners = new Set()
    function setLang(next) {
      if (!next || next === lang) return
      lang = next
      for (const listener of langListeners) listener()
    }
    function useLang() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((n) => n + 1)
        langListeners.add(listener)
        return () => langListeners.delete(listener)
      }, [])
      return lang
    }

    async function rpc(action, payload) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rankings': '1' },
        body: JSON.stringify({ action, ...(payload || {}) }),
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || !body || body.ok !== true) throw new Error((body && body.error) || `HTTP ${response.status}`)
      return body.data
    }

    function formatTime(iso) {
      if (!iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const ICON_PROPS = {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    }

    // 签名元素：三根高度不同的柱子 + 向上的箭头
    function Bars(props) {
      const size = props.size || 18
      return h('svg', { ...ICON_PROPS, width: size, height: size },
        h('path', { d: 'M4 20h16' }),
        h('rect', { x: 5, y: 13, width: 3.4, height: 5, rx: 1 }),
        h('rect', { x: 10.3, y: 9.5, width: 3.4, height: 8.5, rx: 1 }),
        h('rect', { x: 15.6, y: 6, width: 3.4, height: 12, rx: 1 }),
        h('path', { d: 'M17.3 4.2l2.2-.4-.4 2.2' }))
    }

    function Close(props) {
      return h('svg', { ...ICON_PROPS, width: props.size || 14, height: props.size || 14, strokeWidth: 1.8 },
        h('path', { d: 'M6 6l12 12M18 6L6 18' }))
    }

    function Arrow(props) {
      return h('svg', { ...ICON_PROPS, width: props.size || 13, height: props.size || 13, strokeWidth: 1.9,
        style: { transform: props.down ? 'rotate(180deg)' : 'none' } },
        h('path', { d: 'M12 19V5M5.5 11.5L12 5l6.5 6.5' }))
    }

    const CSS = `
.rp-root { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-family: "Geist", "PingFang SC", "HarmonyOS Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; font-size: 13px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
.rp-root *, .rp-root *::before, .rp-root *::after { box-sizing: border-box; }

.rp-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none; }
.rp-mark { display: inline-flex; align-items: flex-end; gap: 2px; height: 18px; flex: none; }
.rp-mark i { width: 4px; border-radius: 1px; background: var(--dsw-alias-brand-primary); display: block; }
.rp-mark i:nth-child(1) { height: 8px; opacity: .55; }
.rp-mark i:nth-child(2) { height: 12px; opacity: .8; }
.rp-mark i:nth-child(3) { height: 18px; }
.rp-head-title { font-size: 15px; font-weight: 600; letter-spacing: .2px; line-height: 1.2; }
.rp-head-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-grow { flex: 1; }
.rp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 10px; font: inherit; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.rp-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.rp-btn:disabled { opacity: .5; cursor: default; }
.rp-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.rp-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; margin: 10px 16px 0; padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); flex: none; }
.rp-tab { height: 28px; padding: 0 8px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12.5px; cursor: pointer; }
.rp-tab:hover { color: var(--dsw-alias-label-primary); }
.rp-tab[data-active="true"] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-weight: 500; }
.rp-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.rp-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px 8px; flex-wrap: wrap; flex: none; }
.rp-seg { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.rp-seg .rp-tab { height: 24px; font-size: 12px; padding: 0 9px; }
.rp-seg .rp-tab[data-active="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); font-weight: 600; }

.rp-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; flex: none; }
.rp-chip { height: 24px; padding: 0 9px; font: inherit; font-size: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.rp-chip:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.rp-chip[data-active="true"] { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); font-weight: 500; }
.rp-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.rp-countries { display: flex; gap: 6px; overflow-x: auto; padding: 0 16px 10px; flex: none; scrollbar-width: none; }
.rp-countries::-webkit-scrollbar { display: none; }
.rp-country { flex: none; height: 22px; padding: 0 8px; font: inherit; font-size: 11.5px; border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.rp-country:hover { color: var(--dsw-alias-label-primary); }
.rp-country[data-active="true"] { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); font-weight: 500; }

.rp-main { flex: 1; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l1); }
.rp-meta { padding: 8px 16px; font-size: 11px; color: var(--dsw-alias-label-secondary); border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: none; font-variant-numeric: tabular-nums; }
.rp-list { flex: 1; min-height: 0; overflow-y: auto; }

.rp-row { display: grid; grid-template-columns: 30px 38px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  width: 100%; padding: 9px 16px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); background: transparent; text-align: left; }
.rp-row:hover { background: var(--dsw-alias-bg-layer-1); }
.rp-rank { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace; font-size: 12px; text-align: right;
  color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.rp-row:nth-child(-n+3) .rp-rank { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.rp-icon { width: 38px; height: 38px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); object-fit: cover; display: block; }
.rp-icon-fallback { display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.rp-row-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.rp-row-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-row-dev { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-summary { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.rp-delta { flex: none; font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace; font-size: 11px; padding: 1px 7px;
  border-radius: 999px; border: 1px solid transparent; font-variant-numeric: tabular-nums; }
.rp-delta[data-kind="up"] { color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.rp-delta[data-kind="down"] { color: var(--dsw-alias-label-secondary); }
.rp-delta[data-kind="new"] { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.rp-delta[data-kind="same"] { color: var(--dsw-alias-label-secondary); opacity: .6; }
.rp-delta[data-kind="days"] { color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l1); }

.rp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 56px 24px; text-align: center; }
.rp-empty-mark { color: var(--dsw-alias-label-secondary); opacity: .7; }
.rp-empty-title { font-size: 14px; font-weight: 600; }
.rp-empty-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); max-width: 340px; line-height: 1.6; }
.rp-banner { margin: 10px 16px; padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); }
.rp-spinner { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 18px 16px; }
`

    function countryName(code, t) {
      const item = COUNTRIES.find((entry) => entry.code === code)
      return item ? item[lang === 'zh' ? 'zh' : 'en'] : code.toUpperCase()
    }

    function DeltaBadge(props) {
      const { app, t } = props
      if (app.isNew) return h('span', { className: 'rp-delta', 'data-kind': 'new' }, t.newBadge)
      if (typeof app.delta === 'number' && app.delta > 0) {
        return h('span', { className: 'rp-delta', 'data-kind': 'up' }, h(Arrow, { size: 11 }), String(app.delta))
      }
      if (typeof app.delta === 'number' && app.delta < 0) {
        return h('span', { className: 'rp-delta', 'data-kind': 'down' }, h(Arrow, { size: 11, down: true }), String(-app.delta))
      }
      return h('span', { className: 'rp-delta', 'data-kind': 'same' }, t.same)
    }

    function Row(props) {
      const { app, t } = props
      const icon = app.icon
        ? h('img', { className: 'rp-icon', src: app.icon, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
        : h('div', { className: 'rp-icon rp-icon-fallback' }, String(app.rank))
      return h('div', { className: 'rp-row' },
        h('span', { className: 'rp-rank', 'data-top': String(app.rank <= 3) }, String(app.rank)),
        icon,
        h('span', { className: 'rp-row-body' },
          h('span', { className: 'rp-row-name' }, app.name),
          app.developer ? h('span', { className: 'rp-row-dev' }, app.developer) : null,
          (app.summaryZh || app.summary) ? h('span', { className: 'rp-summary' }, app.summaryZh || app.summary) : null),
        typeof app.days === 'number' && app.days > 0
          ? h('span', { className: 'rp-delta', 'data-kind': 'new' }, `${app.days}天`)
          : null,
        h(DeltaBadge, { app, t }))
    }

    function SidebarIcon(props) {
      const size = props.size || 18
      return h(Bars, { size })
    }

    // —— 诊断：把浏览器半边的异常回传到 Host（data/client.log），白屏时也能知道原因
    let lastReport = 0
    function report(message) {
      try {
        const now = Date.now()
        if (now - lastReport < 2000) return
        lastReport = now
        fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-rankings': '1' },
          body: JSON.stringify({ action: 'log', message: String(message).slice(0, 4000) }),
        }).catch(() => {})
      } catch {}
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        report(`render crash: ${(error && (error.stack || error.message)) || error}`)
      }
      render() {
        if (this.state.error) {
          return h('div', { className: 'rp-root' },
            h('div', { className: 'rp-empty' },
              h('div', { className: 'rp-empty-title' }, '面板出错了'),
              h('div', { className: 'rp-empty-hint' }, String(this.state.error.message || this.state.error)),
              h('button', { type: 'button', className: 'rp-btn', onClick: () => window.location.reload() }, '重新加载页面')))
        }
        return this.props.children
      }
    }

    function PanelRoot() {
      return h(Boundary, null, h(Panel))
    }

    function Panel() {
      const t = DICT[useLang()]
      const [store, setStore] = React.useState('apple')
      const [country, setCountry] = React.useState('us')
      const [category, setCategory] = React.useState('all')
      const [chart, setChart] = React.useState('free')
      const [view, setView] = React.useState('top')
      const [state, setState] = React.useState({ phase: 'loading' })
      const [countries, setCountries] = React.useState(COUNTRIES.map((item) => item.code))
      const seq = React.useRef(0)

      const effectiveChart = category === 'games'
        ? (store === 'google' ? 'games_free' : `games_${chart}`)
        : (store === 'google' ? 'free' : chart)

      React.useEffect(() => {
        rpc('settings')
          .then((data) => {
            if (Array.isArray(data.countries) && data.countries.length) setCountries(data.countries)
          })
          .catch(() => {})
      }, [])

      const load = React.useCallback(async (force) => {
        const my = ++seq.current
        setState({ phase: 'loading' })
        try {
          const payload = { store, country, chart: effectiveChart }
          const data = view === 'rising'
            ? await rpc('rising', payload)
            : view === 'weekly' || view === 'monthly'
              ? await rpc(view, payload)
              : await rpc('top', { ...payload, force: Boolean(force) })
          if (my === seq.current) setState({ phase: 'ready', data })
        } catch (error) {
          report(`load ${store}/${country}/${effectiveChart}/${view}: ${error.message || error}`)
          if (my === seq.current) setState({ phase: 'error', error: error.message || String(error) })
        }
      }, [store, country, effectiveChart, view])

      React.useEffect(() => {
        report(`panel mounted (${store}/${country}/${view})`)
        load(false)
      }, [load])

      React.useEffect(() => {
        if (store === 'google') setChart('free')
      }, [store])

      const data = state.phase === 'ready' ? state.data : null
      const apps = data && Array.isArray(data.apps) ? data.apps : []
      const gamesOn = effectiveChart.startsWith('games_')
      const chartLabel = gamesOn
        ? (chart === 'paid' ? t.chartGamesPaid : chart === 'grossing' ? t.chartGamesGrossing : t.chartGamesFree)
        : (chart === 'paid' ? t.chartPaid : chart === 'grossing' ? t.chartGrossing : t.chartFree)
      const storeLabel = store === 'google' ? t.googleStore : t.appleStore
      const viewLabel = view === 'rising' ? t.viewRising : view === 'weekly' ? t.viewWeekly : view === 'monthly' ? t.viewMonthly : chartLabel
      const updated = data && data.fetchedAt ? formatTime(data.fetchedAt) : ''
      const range = view === 'weekly' || view === 'monthly'
        ? (data && data.start ? `${data.start} → ${data.end}（${data.days} 天）` : '')
        : ''

      const head = h('div', { className: 'rp-head' },
        h('span', { className: 'rp-mark' }, h('i'), h('i'), h('i')),
        h('span', { className: 'rp-head-title' }, t.title),
        h('span', { className: 'rp-head-sub' }, `${t.subtitle(storeLabel, viewLabel, countryName(country, t))}${apps.length ? ` · ${apps.length} 款` : ''}`),
        h('span', { className: 'rp-grow' }),
        range ? h('span', { className: 'rp-head-sub' }, range) : null,
        updated && view === 'top' ? h('span', { className: 'rp-head-sub' }, t.updated(updated)) : null,
        h('button', {
          type: 'button',
          className: 'rp-btn',
          title: t.prewarmHint,
          onClick: () => {
            rpc('prewarm').catch(() => {})
          },
        }, t.prewarm),
        h('button', {
          type: 'button',
          className: 'rp-btn',
          disabled: state.phase === 'loading',
          onClick: () => load(true),
        }, state.phase === 'loading' ? t.refreshing : t.refresh))

      const storeTabs = h('div', { className: 'rp-seg' },
        h('button', { type: 'button', className: 'rp-tab', 'data-active': String(store === 'apple'), onClick: () => setStore('apple') }, t.storeApple),
        h('button', { type: 'button', className: 'rp-tab', 'data-active': String(store === 'google'), onClick: () => setStore('google') }, t.storeGoogle))

      const chartChips = h('div', { className: 'rp-chips' },
        h('button', { type: 'button', className: 'rp-chip', 'data-active': String(category === 'all' && chart === 'free'),
          disabled: false, onClick: () => { setCategory('all'); setChart('free') } }, t.chartFree),
        h('button', { type: 'button', className: 'rp-chip', 'data-active': String(category === 'all' && chart === 'paid'),
          disabled: store === 'google', onClick: () => { if (store !== 'google') { setCategory('all'); setChart('paid') } } }, t.chartPaid),
        h('button', { type: 'button', className: 'rp-chip', 'data-active': String(category === 'all' && chart === 'grossing'),
          disabled: store === 'google', onClick: () => { if (store !== 'google') { setCategory('all'); setChart('grossing') } } }, t.chartGrossing),
        h('button', { type: 'button', className: 'rp-chip', 'data-active': String(category === 'games'),
          onClick: () => setCategory(category === 'games' ? 'all' : 'games') }, t.catGames))

      const viewTabs = h('div', { className: 'rp-tabs' },
        h('button', { type: 'button', className: 'rp-tab', 'data-active': String(view === 'top'), onClick: () => setView('top') }, t.viewTop),
        h('button', { type: 'button', className: 'rp-tab', 'data-active': String(view === 'weekly'), onClick: () => setView('weekly') }, t.viewWeekly),
        h('button', { type: 'button', className: 'rp-tab', 'data-active': String(view === 'monthly'), onClick: () => setView('monthly') }, t.viewMonthly),
        h('button', { type: 'button', className: 'rp-tab', 'data-active': String(view === 'rising'), onClick: () => setView('rising') }, t.viewRising))

      const toolbar = h('div', { className: 'rp-toolbar' }, storeTabs, chartChips)

      const activeCountries = store === 'google' ? countries.filter((code) => code !== 'cn') : countries
      const countryRow = h('div', { className: 'rp-countries' },
        activeCountries.map((code) => h('button', {
          key: code,
          type: 'button',
          className: 'rp-country',
          'data-active': String(code === country),
          onClick: () => setCountry(code),
        }, countryName(code, t))))

      const note = store === 'google' ? h('div', { className: 'rp-meta' }, t.googleNote) : null

      let body = null
      if (state.phase === 'loading') {
        body = h('div', { className: 'rp-main' },
          h('div', { className: 'rp-list' },
            h('div', { className: 'rp-empty' },
              h('span', { className: 'rp-empty-mark' }, h(Bars, { size: 30 })),
              h('div', { className: 'rp-empty-title' }, t.loading))))
      } else if (state.phase === 'error') {
        body = h('div', { className: 'rp-main' },
          h('div', { className: 'rp-list' },
            h('div', { className: 'rp-empty' },
              h('div', { className: 'rp-empty-title' }, t.loadFail),
              h('div', { className: 'rp-empty-hint' }, String(state.error)),
              h('button', { type: 'button', className: 'rp-btn', onClick: () => load(true) }, t.retry))))
      } else if (view === 'rising' && data && data.ready === false) {
        const baseline = data.reason === 'baseline'
        body = h('div', { className: 'rp-main' },
          h('div', { className: 'rp-list' },
            h('div', { className: 'rp-empty' },
              h('span', { className: 'rp-empty-mark' }, h(Bars, { size: 30 })),
              h('div', { className: 'rp-empty-title' }, baseline ? t.baselineTitle : t.emptyRising),
              h('div', { className: 'rp-empty-hint' }, baseline ? t.baselineHint : t.emptyRisingHint))))
      } else if (!apps.length) {
        body = h('div', { className: 'rp-main' },
          h('div', { className: 'rp-list' },
            h('div', { className: 'rp-empty' },
              h('div', { className: 'rp-empty-title' }, t.emptyTop),
              h('div', { className: 'rp-empty-hint' }, t.emptyTopHint),
              h('button', { type: 'button', className: 'rp-btn', onClick: () => load(true) }, t.refresh))))
      } else {
        const metaText = view === 'weekly' || view === 'monthly'
          ? (data && data.start ? `${data.start} → ${data.end} · ${data.days} 天 · 按平均名次排` : '')
          : view === 'rising'
            ? (data && data.date ? `${data.date} 对比 ${data.previous || '—'}` : '')
            : (data && data.day ? `快照 ${data.day} · ${apps.length} 款` : `${apps.length} 款`)
        body = h('div', { className: 'rp-main' },
          metaText ? h('div', { className: 'rp-meta' }, metaText) : null,
          h('div', { className: 'rp-list' },
            apps.map((app) => h(Row, { key: app.id, app, t }))))
      }

      return h('div', { className: 'rp-root' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        head,
        viewTabs,
        toolbar,
        countryRow,
        note,
        body)
    }

    function apply(ctx) {
      ctx.inject(['locale'], (scope) => {
        const push = (snapshot) => setLang(/^zh/i.test(snapshot.active || '') ? 'zh' : 'en')
        push(scope.locale.getSnapshot())
        scope.on('locale/change', push)
      })

      const onError = (event) => report(`window.error: ${event.message || ''}\n${(event.error && event.error.stack) || ''}`)
      const onRejection = (event) => {
        const reason = event.reason
        report(`unhandledrejection: ${(reason && (reason.stack || reason.message)) || String(reason)}`)
      }
      const mount = () => {
        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onRejection)
        return () => {
          window.removeEventListener('error', onError)
          window.removeEventListener('unhandledrejection', onRejection)
        }
      }
      if (typeof ctx.effect === 'function') ctx.effect(mount)
      else mount()

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 9, label: () => DICT[lang].panel }, SidebarIcon))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, PanelRoot))
    }

    return { inject: ['slots'], apply, __internals: { Panel, Row, DICT } }
  },
})
