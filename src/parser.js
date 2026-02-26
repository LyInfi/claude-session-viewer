const fs = require('fs')
const path = require('path')
const readline = require('readline')
const os = require('os')

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir()
const CLAUDE_PROJECTS_DIR = path.join(HOME_DIR, '.claude', 'projects')

/**
 * 从 content 中提取纯文本
 */
function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
  }
  return ''
}

/**
 * 解析 content blocks（返回结构化数组）
 */
function parseContentBlocks(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (!Array.isArray(content)) return []

  return content.map(block => {
    const type = block.type
    if (type === 'text') {
      return { type: 'text', text: block.text || '' }
    }
    if (type === 'thinking') {
      return { type: 'thinking', text: block.thinking || '' }
    }
    if (type === 'tool_use') {
      return {
        type: 'tool_use',
        name: block.name,
        id: block.id,
        input: block.input
      }
    }
    if (type === 'tool_result') {
      const resultContent = block.content
      let text = ''
      if (typeof resultContent === 'string') text = resultContent
      else if (Array.isArray(resultContent)) {
        text = resultContent
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('\n')
      }
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        text: text.slice(0, 5000) // 截断超长 tool result
      }
    }
    return { type, raw: block }
  })
}

/**
 * 完整解析一个 session 文件
 */
async function parseSession(projectId, sessionId) {
  const filePath = path.join(CLAUDE_PROJECTS_DIR, projectId, `${sessionId}.jsonl`)
  if (!fs.existsSync(filePath)) return null

  return new Promise((resolve, reject) => {
    const messages = []
    let sessionMeta = {}

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    })

    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line)

        // 提取 session 元数据
        if (!sessionMeta.sessionId && obj.sessionId) {
          sessionMeta = {
            sessionId: obj.sessionId,
            cwd: obj.cwd,
            version: obj.version,
            gitBranch: obj.gitBranch
          }
        }

        const type = obj.type
        if (type !== 'user' && type !== 'assistant') return

        const msg = obj.message || {}
        const role = msg.role || type
        const blocks = parseContentBlocks(msg.content)

        // 跳过纯系统消息（无实际内容）
        const hasContent = blocks.some(b =>
          b.type === 'text' && b.text && b.text.trim() && !b.text.startsWith('<local-command-') ||
          b.type === 'tool_use' ||
          b.type === 'tool_result' ||
          b.type === 'thinking'
        )

        messages.push({
          uuid: obj.uuid,
          parentUuid: obj.parentUuid,
          role,
          blocks,
          timestamp: obj.timestamp,
          model: msg.model,
          hasContent,
          isSidechain: obj.isSidechain || false
        })
      } catch {
        // ignore parse errors
      }
    })

    rl.on('close', () => resolve({ meta: sessionMeta, messages }))
    rl.on('error', reject)
  })
}

/**
 * 搜索 session 文件中的关键词（返回匹配片段）
 */
async function searchInSession(filePath, keyword) {
  const keyLower = keyword.toLowerCase()
  const matches = []

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    })

    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line)
        if (obj.type !== 'user' && obj.type !== 'assistant') return

        const text = extractText(obj.message?.content || '')
        if (text.toLowerCase().includes(keyLower)) {
          // 找到关键词位置，提取上下文
          const idx = text.toLowerCase().indexOf(keyLower)
          const start = Math.max(0, idx - 60)
          const end = Math.min(text.length, idx + keyword.length + 60)
          matches.push({
            role: obj.message?.role || obj.type,
            timestamp: obj.timestamp,
            snippet: text.slice(start, end)
          })
        }
      } catch {
        // ignore
      }
    })

    rl.on('close', () => resolve(matches))
    rl.on('error', () => resolve([]))
  })
}

module.exports = { parseSession, searchInSession, extractText }
