const fs = require('fs')
const readline = require('readline')

/**
 * 从 JSONL 文件前几行提取 session 摘要信息
 */
async function readSessionSummary(filePath) {
  return new Promise((resolve) => {
    const summary = {
      cwd: null,
      version: null,
      gitBranch: null,
      firstUserMessage: null,
      startTime: null,
      endTime: null,
      messageCount: 0,
      hasAssistant: false
    }

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    })

    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line)

        if (!summary.cwd && obj.cwd) summary.cwd = obj.cwd
        if (!summary.version && obj.version) summary.version = obj.version
        if (!summary.gitBranch && obj.gitBranch) summary.gitBranch = obj.gitBranch
        if (!summary.startTime && obj.timestamp) summary.startTime = obj.timestamp
        if (obj.timestamp) summary.endTime = obj.timestamp

        const type = obj.type
        if (type === 'user' || type === 'assistant') {
          summary.messageCount++
          if (type === 'assistant') summary.hasAssistant = true

          if (!summary.firstUserMessage && type === 'user') {
            const content = obj.message?.content
            const text = extractText(content)
            if (text && text.trim() && !text.startsWith('<')) {
              summary.firstUserMessage = text.slice(0, 200)
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    })

    rl.on('close', () => resolve(summary))
    rl.on('error', () => resolve(summary))
  })
}

function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join(' ')
  }
  return ''
}

module.exports = { readSessionSummary }
