const express = require('express')
const { scanProjects, scanSessions } = require('./scanner')
const { parseSession } = require('./parser')
const { globalSearch } = require('./search')

const router = express.Router()

// GET /api/projects
router.get('/projects', async (req, res) => {
  try {
    const projects = await scanProjects()
    res.json({ success: true, data: projects })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/projects/:projectId/sessions
router.get('/projects/:projectId/sessions', async (req, res) => {
  try {
    const { projectId } = req.params
    const sessions = await scanSessions(projectId)
    if (!sessions) {
      return res.status(404).json({ success: false, error: '项目不存在' })
    }
    res.json({ success: true, data: sessions })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/sessions/:sessionId?projectId=xxx
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { projectId } = req.query
    if (!projectId) {
      return res.status(400).json({ success: false, error: '缺少 projectId 参数' })
    }

    const result = await parseSession(projectId, sessionId)
    if (!result) {
      return res.status(404).json({ success: false, error: 'Session 不存在' })
    }
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/search?q=keyword&project=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/search', async (req, res) => {
  try {
    const { q, project, from, to } = req.query
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: '搜索关键词至少需要 2 个字符' })
    }

    const results = await globalSearch(q, { project, from, to })
    res.json({ success: true, data: results, total: results.length })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
