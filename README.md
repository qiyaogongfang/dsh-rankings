# 软件排行榜

在 DSH 侧栏看苹果 App Store 与谷歌 Play 的每日榜单、飙升榜和软件简介；数据留在本机，模型也能直接查。

## 功能

- **苹果榜单**：免费 / 付费 / 收入榜，外加游戏免费 / 游戏付费 / 游戏收入榜，每国前 100 名（免费源的上限）。
- **谷歌榜单**：网页端可见的免费榜和游戏榜，各约 20 条；没有官方接口，页面改版可能失效。
- **周榜 / 月榜**：按过去 7 / 30 天的每日快照聚合，按平均名次排序，附在榜天数和最佳名次。
- **飙升榜**：每天自动存一份快照，对比前后两天名次，算出名次上升最快、以及新进榜的 App。
- **软件简介**：每条榜单下面直接带一句话中文简介；原文可能是英/日/韩/德等语言，用本机 Ollama 统一翻成中文并缓存。
- **预缓存**：启动后自动把全部国家/榜单抓取并翻译好，面板里还有「预缓存」按钮手动触发。
- **本地存储**：快照是 `data/` 下的纯 JSON，不依赖数据库。

## 数据来源

| 平台 | 榜单 | 来源 |
| :-- | :-- | :-- |
| 苹果 App Store | 免费 / 付费 / 收入 | 官方接口 `rss.marketingtools.apple.com` + 收入榜旧 RSS；简介走 lookup 批量查询 |
| 苹果 App Store | 游戏三榜 | 旧 RSS `genre=6014`（游戏分类） |
| 谷歌 Play | 免费 / 游戏（各约 20 条） | 网页抓取 `store/apps/top` 与 `category/GAME`；简介取详情页官方短描述，缓存在本地 |

> 谷歌只取网页可见部分（约 20–40 条），没有分页接口；苹果榜单接口最多给 100 条，`limit=50` 反而会稳定 502，所以统一取 100。榜单变长后预缓存要翻的条数也翻倍，首次预热会更久。
>
> 简介翻译走本机 Ollama：默认 `qwen3.8:latest`，可用环境变量 `RANKINGS_OLLAMA_URL` / `RANKINGS_TRANSLATE_MODEL` 改。中文原文（中国区商店）直接沿用，不再翻译。

## 安装

DSH 插件管理里搜 `dsh-rankings`，或命令行（npm 包尚未发布时用 GitHub Release 包）：

```bash
dsh plugin add -w "https://github.com/qiyaogongfang/dsh-rankings/releases/download/v0.1.0/dsh-rankings.tgz"
```

npm 发布后也可以用：

```bash
dsh plugin --profile web add @qiyaogongfang/dsh-rankings
```

装完刷新页面，左侧栏出现「软件排行榜」。想要中文简介，需要本机跑着 Ollama（关掉就显示原文）。

## 模型工具

| 工具 | 用途 |
| :-- | :-- |
| `rank_top` | 查指定商店、国家、榜单（含游戏榜）的前 100（谷歌约 20–40） |
| `rank_rising` | 查飙升榜（对比最近一次更早的快照） |
| `rank_app` | 按商店 id 查单个 App 的介绍 |

## 目录结构

```text
rankings/
├── index.js          Host：接口 + 三个工具 + 每日快照
├── client.js         浏览器半边：侧栏面板
├── store.js          快照存储与飙升计算
├── http.js           网络：直连失败自动走系统代理（Windows 注册表）
├── fetch-apple.js    苹果榜单与 lookup
├── fetch-play.js     谷歌榜单与详情页抓取
├── cordis.patch.yml  插件行声明
├── locale/           zh / en 元数据
└── data/             运行时生成：snapshots、descriptions、config.json
```

## 开发

本地目录直接挂进 profile：`node_modules/@local/rankings` 指向本目录（junction / symlink），
`cordis.patch.yml` 里 insert 一行 `@local/rankings`。改 `client.js` 刷新页面；改 Host 文件需要重载插件。
