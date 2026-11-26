// 用本机 Ollama 把英文简介翻成中文。模型不带思考（think:false）时几秒一批；
// 关了 Ollama 就退回英文原文，不影响榜单本身。
import { request } from './http.js'

const BASE = process.env.RANKINGS_OLLAMA_URL || 'http://127.0.0.1:11434'
const MODEL = process.env.RANKINGS_TRANSLATE_MODEL || 'qwen3.8:latest'

function parseNumbered(text, expected) {
  const out = new Array(expected).fill('')
  const re = /^\s*(\d+)\s*[.、)．]\s*(.+)$/gm
  let match
  while ((match = re.exec(text))) {
    const index = Number(match[1]) - 1
    if (index >= 0 && index < expected) out[index] = match[2].trim().replace(/^["“]|["”]$/g, '')
  }
  return out
}

/** 把若干条英文简介翻成中文；返回与输入等长的数组（失败处为空串）。 */
export async function translateLines(lines) {
  const list = (lines || []).map((line) => String(line || '').trim()).filter(Boolean)
  if (!list.length) return []
  const numbered = list.map((line, index) => `${index + 1}. ${line}`).join('\n')
  const payload = {
    model: MODEL,
    think: false,
    stream: false,
    options: { temperature: 0 },
    messages: [
      {
        role: 'system',
        content: '你是翻译器。把用户给的编号应用简介逐条译成简体中文（原文可能是英文、日文、韩文、德文、法文等任何语言）。每条不超过 40 字，保留原意、语气自然。输出相同数量的编号列表，只输出译文，不要解释。',
      },
      { role: 'user', content: numbered },
    ],
  }
  const res = await request(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 60000,
  })
  const data = JSON.parse(res.body)
  const text = (data.message && data.message.content) || ''
  return parseNumbered(text, list.length)
}
