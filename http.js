// 网络层：优先直连，失败则走系统代理（环境变量 / Windows 注册表），跟随重定向，解压 gzip。
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

let proxyCache

function regQuery(value) {
  try {
    const out = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      value,
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    return out
  } catch {
    return ''
  }
}

function parseProxyString(raw) {
  if (!raw) return null
  const value = String(raw).trim()
  if (!value) return null
  const parts = value.split(';')
  let chosen = value
  if (parts.length > 1) {
    const httpsPart = parts.find((item) => /(^|;)https=/.test(`;${item}`)) || parts.find((item) => /https=/.test(item))
    chosen = httpsPart ? httpsPart.split('=').slice(1).join('=') : parts[0].split('=').slice(1).join('=') || parts[0]
  }
  const candidate = chosen.includes('://') ? chosen : `http://${chosen}`
  try {
    const url = new URL(candidate)
    if (!url.hostname) return null
    const port = Number(url.port || 80)
    if (!Number.isFinite(port) || port <= 0) return null
    return { host: url.hostname, port }
  } catch {
    return null
  }
}

/** 当前可用的 HTTP 代理；没有代理时返回 null。 */
export function proxyInfo() {
  if (proxyCache !== undefined) return proxyCache
  proxyCache = null
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (env) {
    proxyCache = parseProxyString(env)
    if (proxyCache) return proxyCache
  }
  if (process.platform === 'win32') {
    const enabled = regQuery('ProxyEnable')
    if (/0x1/.test(enabled)) {
      const server = regQuery('ProxyServer')
      const match = server.match(/ProxyServer\s+REG_SZ\s+(.+)/)
      if (match) proxyCache = parseProxyString(match[1].trim())
    }
  }
  return proxyCache
}

function decodeBody(buffer, encoding) {
  const kind = String(encoding || '').toLowerCase()
  try {
    if (kind.includes('br')) return zlib.brotliDecompressSync(buffer)
    if (kind.includes('gzip')) return zlib.gunzipSync(buffer)
    if (kind.includes('deflate')) return zlib.inflateSync(buffer)
  } catch {
    return buffer
  }
  return buffer
}

function collect(res, resolve, reject) {
  const chunks = []
  let size = 0
  res.on('data', (chunk) => {
    size += chunk.length
    if (size > 24 * 1024 * 1024) {
      res.destroy(new Error('响应太大'))
      return
    }
    chunks.push(chunk)
  })
  res.on('end', () => {
    try {
      const body = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf8')
      resolve({ status: res.statusCode || 0, headers: res.headers, body })
    } catch (error) {
      reject(error)
    }
  })
  res.on('error', reject)
  res.on('aborted', () => reject(new Error('连接中断')))
}

function sendViaTunnel(target, opts, baseHeaders, proxy) {
  return new Promise((resolve, reject) => {
    const port = target.port || '443'
    const connect = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${target.hostname}:${port}`,
      headers: { host: `${target.hostname}:${port}` },
      timeout: opts.timeout,
    })
    connect.on('connect', (res, socket) => {
      if ((res.statusCode || 0) !== 200) {
        socket.destroy()
        reject(new Error(`代理拒绝 CONNECT：${res.statusCode}`))
        return
      }
      const req = https.request({
        host: target.hostname,
        port,
        path: target.pathname + target.search,
        method: opts.method,
        headers: baseHeaders,
        timeout: opts.timeout,
        createConnection: () => tls.connect({ socket, servername: target.hostname }),
      }, (response) => collect(response, resolve, reject))
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('请求超时')))
      if (opts.body) req.write(opts.body)
      req.end()
    })
    connect.on('error', reject)
    connect.on('timeout', () => connect.destroy(new Error('代理连接超时')))
    connect.end()
  })
}

function once(url, opts, useProxy) {
  const target = new URL(url)
  const isHttps = target.protocol === 'https:'
  const baseHeaders = {
    'user-agent': opts.userAgent || UA,
    'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    'accept-encoding': 'gzip, deflate, br',
    ...opts.headers,
  }
  if (opts.body) baseHeaders['content-length'] = Buffer.byteLength(opts.body)
  const proxy = useProxy ? proxyInfo() : null

  if (isHttps && proxy) return sendViaTunnel(target, opts, baseHeaders, proxy)

  return new Promise((resolve, reject) => {
    const mod = isHttps ? https : http
    const request = mod.request({
      host: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: proxy ? target.toString() : target.pathname + target.search,
      method: opts.method,
      headers: proxy ? { ...baseHeaders, host: target.hostname } : baseHeaders,
      timeout: opts.timeout,
    }, (response) => collect(response, resolve, reject))
    request.on('error', reject)
    request.on('timeout', () => request.destroy(new Error('请求超时')))
    if (opts.body) request.write(opts.body)
    request.end()
  })
}

/** 直连失败过的主机记住，后面直接走代理，避免每次先等直连超时。 */
const directBlocked = new Set()

/** GET/POST 文本内容；重定向自动跟随。 */
export async function request(url, options = {}) {
  const opts = {
    method: options.method || 'GET',
    headers: options.headers || {},
    timeout: options.timeout || 25000,
    body: options.body,
    userAgent: options.userAgent,
  }
  let current = url
  let lastError = null
  for (let hop = 0; hop < 6; hop++) {
    const host = new URL(current).hostname
    let res = null
    if (!directBlocked.has(host)) {
      try {
        res = await once(current, opts, false)
      } catch (error) {
        lastError = error
        directBlocked.add(host)
        res = await once(current, opts, true)
      }
    } else {
      res = await once(current, opts, true)
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).toString()
      continue
    }
    if (res.status >= 400) {
      const error = new Error(`HTTP ${res.status}`)
      error.status = res.status
      error.body = res.body
      throw error
    }
    return res
  }
  throw lastError || new Error('重定向次数过多')
}

/** 抓 JSON。 */
export async function requestJson(url, options = {}) {
  const res = await request(url, options)
  try {
    return JSON.parse(res.body)
  } catch {
    throw new Error('响应不是合法 JSON')
  }
}

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** 把 HTML 片段变成纯文本。 */
export function htmlToText(fragment) {
  return decodeEntities(
    String(fragment || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
