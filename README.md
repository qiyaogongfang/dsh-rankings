# 软件排行榜 · dsh-rankings

在 DeepSeek Harness 侧栏看苹果 App Store 与 Google Play 的榜单：日榜 / 周榜 / 月榜 / 飙升榜，免费、付费、收入、游戏榜，每款应用一句话中文简介。

## 功能

- **17 个国家/地区**：us 美国、jp 日本、kr 韩国、de 德国、gb 英国、in 印度、cn 中国、fr 法国、ca 加拿大、au 澳大利亚、br 巴西、id 印尼、th 泰国、vn 越南、tw 台湾、hk 香港、sg 新加坡
- **苹果 6 个榜**：免费、付费、收入、游戏免费、游戏付费、游戏收入，每榜前 100
- **谷歌 2 个榜**：免费、游戏，约 20–40 条（网页可见量，非官方 API；中国大陆无 Google Play）
- **4 个周期**：日榜、周榜（7 天平均名次）、月榜（30 天平均名次）、飙升榜（前后两天名次差）
- **一句话中文简介**：抓取后由本机 Ollama 翻译并缓存，切换语言不影响已有缓存
- **本地快照**：按 `store/country/chart/date` 存 JSON，保留历史，周榜/月榜靠它聚合
- **云端同步（可选）**：配置后把快照与苹果评论推到自建 Cloudflare 服务 `rank.71lab.net`，供 Chrome 扩展读取

## 安装

在 DSH 的插件管理器里搜索 `dsh-rankings` 或「软件排行榜」安装。也可以命令行：

```bash
dsh plugin --profile desktop add @qiyaogongfang/dsh-rankings
```

或直接用 GitHub Release 的 tarball：

```bash
dsh plugin --profile desktop add https://github.com/qiyaogongfang/dsh-rankings/releases/download/v0.2.0/qiyaogongfang-dsh-rankings-0.2.0.tgz
```

安装后侧栏出现「软件排行榜」入口；首次打开会依次抓取，预缓存按钮可一次性补齐全部分区。

## 数据来源

- 苹果：marketingtools RSS（免费/付费）+ 旧版 iTunes RSS（收入榜、游戏三榜），逐国抓取
- 谷歌：Play 网页解析（免费榜、游戏分类页）
- 翻译：本机 Ollama（默认 `qwen3.8:latest`，`think:false`），失败保留英文原文
- 云端：本机抓取后 `POST /api/ingest`，云端用千问批量翻译并落 D1

## 配置

`data/worker.json`（可选，不配也能本地用）：

```json
{ "url": "https://rank.71lab.net", "key": "<ingest key>", "enabled": true }
```

## 已知限制

- 谷歌榜单只有网页可见的 20–40 条，不是 Top 100
- 苹果旧版 RSS 在 Cloudflare IP 上会 403，所以收入榜与游戏榜依赖本机插件推送
- 周榜/月榜需要历史快照，刚装时窗口不足 7/30 天
- 评论同步是串行队列（30 秒一条），云端可能滞后

## 开发

```bash
npm install
npm pack
```

目录：

```
dsh-rankings/
├── index.js        Host：工具、动作、抓取、翻译、推送
├── client.js       浏览器：侧栏面板
├── store.js        快照存储、聚合、配置
├── http.js         直连/代理回退、gzip/br
├── fetch-apple.js  苹果榜单与评论
├── fetch-play.js   谷歌榜单与详情
├── translate.js    本机 Ollama 翻译
├── cordis.patch.yml
└── locale/         zh / en
```

## 许可证

MIT
