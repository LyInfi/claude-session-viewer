const fs = require('fs')
const path = require('path')
const readline = require('readline')

const CLAUDE_PROJECTS_DIR = path.join(process.env.HOME, '.claude', 'projects')

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

/**
 * 扫描所有项目，返回项目列表
 */
async function scanProjects() {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return []

  const entries = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
  const projectDirs = entries.filter(e => e.isDirectory())

  const projects = []
  for (const dir of projectDirs) {
    const projectId = dir.name
    const projectPath = path.join(CLAUDE_PROJECTS_DIR, projectId)
    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))

    if (jsonlFiles.length === 0) continue

    // 从第一个文件提取 cwd 作为 displayName
    let displayName = projectId
    let lastActivity = null

    for (const f of jsonlFiles.slice(0, 3)) {
      const stat = fs.statSync(path.join(projectPath, f))
      const mtime = stat.mtime.toISOString()
      if (!lastActivity || mtime > lastActivity) lastActivity = mtime

      if (displayName === projectId) {
        const summary = await readSessionSummary(path.join(projectPath, f))
        if (summary.cwd) {
          displayName = summary.cwd
        }
      }
    }

    // 如果没有从文件中读到 cwd，从目录名推断
    if (displayName === projectId) {
      displayName = decodeProjectId(projectId)
    }

    projects.push({
      id: projectId,
      displayName,
      sessionCount: jsonlFiles.length,
      lastActivity
    })
  }

  // 按最后活动时间倒序
  return projects.sort((a, b) => {
    if (!a.lastActivity) return 1
    if (!b.lastActivity) return -1
    return b.lastActivity.localeCompare(a.lastActivity)
  })
}

/**
 * 将目录名尝试解码为路径（备用方案）
 */
function decodeProjectId(id) {
  // -mnt-c-Users-shenx-Documents-AIProject -> /mnt/c/Users/shenx/Documents/AIProject
  return id.replace(/^-/, '/').replace(/-/g, '/')
}

/**
 * 扫描某项目下的所有 session
 */
async function scanSessions(projectId) {
  const projectPath = path.join(CLAUDE_PROJECTS_DIR, projectId)
  if (!fs.existsSync(projectPath)) return null

  const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))

  const sessions = []
  for (const file of files) {
    const sessionId = file.replace('.jsonl', '')
    const filePath = path.join(projectPath, file)
    const stat = fs.statSync(filePath)
    const summary = await readSessionSummary(filePath)

    sessions.push({
      id: sessionId,
      projectId,
      firstUserMessage: summary.firstUserMessage || '(无用户消息)',
      messageCount: summary.messageCount,
      startTime: summary.startTime || stat.birthtime.toISOString(),
      endTime: summary.endTime || stat.mtime.toISOString(),
      version: summary.version,
      gitBranch: summary.gitBranch,
      cwd: summary.cwd,
      hasAssistant: summary.hasAssistant
    })
  }

  // 按开始时间倒序
  return sessions.sort((a, b) => b.startTime.localeCompare(a.startTime))
}

module.exports = { scanProjects, scanSessions, CLAUDE_PROJECTS_DIR }
