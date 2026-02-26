const express = require('express')
const { scanProjects, scanSessions, deleteSession, readSessionSummary } = require('./scanner')
const { parseSession } = require('./parser')
const { globalSearch } = require('./search')
const { restoreFromTrash, permanentlyDelete, emptyTrash, listTrash } = require('./trash')

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

// DELETE /api/sessions/:sessionId?projectId=xxx (移入回收站)
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { projectId } = req.query

    if (!projectId) {
      return res.status(400).json({ success: false, error: '缺少 projectId 参数' })
    }

    const result = await deleteSession(projectId, sessionId)
    res.json({ success: true, message: 'Session 已移至回收站', data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── Trash Routes ─────────────────────────────────────────────

// GET /api/trash - 获取回收站列表
router.get('/trash', async (req, res) => {
  try {
    const result = await listTrash()
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/trash/:sessionId/restore?projectId=xxx - 恢复
router.post('/trash/:sessionId/restore', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { projectId } = req.query

    if (!projectId) {
      return res.status(400).json({ success: false, error: '缺少 projectId 参数' })
    }

    const result = await restoreFromTrash(projectId, sessionId)
    res.json({ success: true, message: 'Session 已恢复', data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/trash/:sessionId?projectId=xxx - 永久删除
router.delete('/trash/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { projectId } = req.query

    if (!projectId) {
      return res.status(400).json({ success: false, error: '缺少 projectId 参数' })
    }

    await permanentlyDelete(projectId, sessionId)
    res.json({ success: true, message: 'Session 已永久删除' })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/trash - 清空回收站
router.delete('/trash', async (req, res) => {
  try {
    const result = await emptyTrash()
    res.json({ success: true, message: '回收站已清空', data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
