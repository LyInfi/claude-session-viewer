const fs = require('fs')
const path = require('path')
const os = require('os')
const { searchInSession } = require('./parser')

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir()
const CLAUDE_PROJECTS_DIR = path.join(HOME_DIR, '.claude', 'projects')

/**
 * 全局搜索
 * @param {string} keyword
 * @param {object} options - { project, from, to }
 */
async function globalSearch(keyword, options = {}) {
  if (!keyword || keyword.trim().length < 2) return []

  const { project: projectFilter, from, to } = options
  const results = []

  const projects = fs.existsSync(CLAUDE_PROJECTS_DIR)
    ? fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
    : []

  const filteredProjects = projectFilter
    ? projects.filter(p => p === projectFilter)
    : projects

  for (const projectId of filteredProjects) {
    const projectPath = path.join(CLAUDE_PROJECTS_DIR, projectId)
    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))

    for (const file of files) {
      const filePath = path.join(projectPath, file)
      const stat = fs.statSync(filePath)
      const mtime = stat.mtime.toISOString()

      // 日期过滤
      if (from && mtime < from) continue
      if (to && mtime > to + 'T23:59:59Z') continue

      const matches = await searchInSession(filePath, keyword)
      if (matches.length > 0) {
        const sessionId = file.replace('.jsonl', '')
        results.push({
          projectId,
          sessionId,
          matchCount: matches.length,
          matches: matches.slice(0, 3), // 最多返回 3 条匹配片段
          lastModified: mtime
        })
      }
    }
  }

  // 按匹配数量排序
  return results.sort((a, b) => b.matchCount - a.matchCount)
}

module.exports = { globalSearch }
