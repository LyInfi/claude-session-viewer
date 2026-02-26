const fs = require('fs')
const path = require('path')

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || require('os').homedir()
const CLAUDE_PROJECTS_DIR = path.join(HOME_DIR, '.claude', 'projects')
const TRASH_DIR = path.join(HOME_DIR, '.claude', 'trash')
const TRASH_METADATA = path.join(TRASH_DIR, 'metadata.json')
const AUTO_DELETE_DAYS = 30

/**
 * 确保回收站目录存在
 */
function ensureTrashDir() {
  if (!fs.existsSync(TRASH_DIR)) {
    fs.mkdirSync(TRASH_DIR, { recursive: true })
  }
}

/**
 * 读取回收站元数据
 */
function readMetadata() {
  if (!fs.existsSync(TRASH_METADATA)) {
    return { version: '1.0', items: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(TRASH_METADATA, 'utf8'))
  } catch {
    return { version: '1.0', items: [] }
  }
}

/**
 * 写入回收站元数据
 */
function writeMetadata(metadata) {
  ensureTrashDir()
  fs.writeFileSync(TRASH_METADATA, JSON.stringify(metadata, null, 2))
}

/**
 * 验证参数安全（防止路径遍历）
 */
function validateParams(projectId, sessionId) {
  if (!projectId || !sessionId) {
    throw new Error('缺少必要参数')
  }
  if (projectId.includes('..') || sessionId.includes('..')) {
    throw new Error('无效的参数')
  }
  if (projectId.includes('/') || projectId.includes('\\')) {
    throw new Error('无效的项目ID')
  }
}

/**
 * 移入回收站（软删除）
 */
async function moveToTrash(projectId, sessionId) {
  validateParams(projectId, sessionId)

  const sourcePath = path.join(CLAUDE_PROJECTS_DIR, projectId, `${sessionId}.jsonl`)
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Session 不存在')
  }

  ensureTrashDir()

  const timestamp = Date.now()
  const trashProjectDir = path.join(TRASH_DIR, projectId)
  if (!fs.existsSync(trashProjectDir)) {
    fs.mkdirSync(trashProjectDir, { recursive: true })
  }

  const fileName = `${sessionId}.${timestamp}.jsonl`
  const destPath = path.join(trashProjectDir, fileName)

  // 移动文件
  fs.renameSync(sourcePath, destPath)

  // 更新元数据
  const metadata = readMetadata()
  const deletedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + AUTO_DELETE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // 移除已存在的相同 session 记录（如果之前有删除过）
  metadata.items = metadata.items.filter(item =>
    !(item.projectId === projectId && item.sessionId === sessionId)
  )

  metadata.items.push({
    projectId,
    sessionId,
    originalPath: sourcePath,
    deletedAt,
    expiresAt,
    fileName
  })
  writeMetadata(metadata)

  return {
    projectId,
    sessionId,
    deletedAt,
    expiresAt
  }
}

/**
 * 从回收站恢复
 */
async function restoreFromTrash(projectId, sessionId) {
  validateParams(projectId, sessionId)

  const metadata = readMetadata()
  const item = metadata.items.find(i => i.projectId === projectId && i.sessionId === sessionId)

  if (!item) {
    throw new Error('Session 不在回收站中')
  }

  const trashPath = path.join(TRASH_DIR, projectId, item.fileName)
  if (!fs.existsSync(trashPath)) {
    // 文件已丢失，从元数据中移除
    metadata.items = metadata.items.filter(i => i !== item)
    writeMetadata(metadata)
    throw new Error('Session 文件已丢失')
  }

  // 确保原项目目录存在
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId)
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }

  const destPath = path.join(projectDir, `${sessionId}.jsonl`)

  // 如果目标位置已存在文件，先备份
  if (fs.existsSync(destPath)) {
    const backupPath = `${destPath}.backup.${Date.now()}`
    fs.renameSync(destPath, backupPath)
  }

  // 移动文件回原位置
  fs.renameSync(trashPath, destPath)

  // 从元数据中移除
  metadata.items = metadata.items.filter(i => i !== item)
  writeMetadata(metadata)

  // 清理空目录
  cleanupEmptyDir(path.join(TRASH_DIR, projectId))

  return {
    projectId,
    sessionId,
    restoredAt: new Date().toISOString()
  }
}

/**
 * 从回收站永久删除
 */
async function permanentlyDelete(projectId, sessionId) {
  validateParams(projectId, sessionId)

  const metadata = readMetadata()
  const item = metadata.items.find(i => i.projectId === projectId && i.sessionId === sessionId)

  if (!item) {
    throw new Error('Session 不在回收站中')
  }

  const trashPath = path.join(TRASH_DIR, projectId, item.fileName)

  // 删除文件
  if (fs.existsSync(trashPath)) {
    fs.unlinkSync(trashPath)
  }

  // 从元数据中移除
  metadata.items = metadata.items.filter(i => i !== item)
  writeMetadata(metadata)

  // 清理空目录
  cleanupEmptyDir(path.join(TRASH_DIR, projectId))

  return {
    projectId,
    sessionId,
    deletedAt: new Date().toISOString()
  }
}

/**
 * 清空回收站
 */
async function emptyTrash() {
  const metadata = readMetadata()
  const errors = []

  for (const item of metadata.items) {
    try {
      const trashPath = path.join(TRASH_DIR, item.projectId, item.fileName)
      if (fs.existsSync(trashPath)) {
        fs.unlinkSync(trashPath)
      }
    } catch (err) {
      errors.push({ item, error: err.message })
    }
  }

  // 清理所有空目录
  cleanupAllEmptyDirs(TRASH_DIR)

  // 重置元数据
  writeMetadata({ version: '1.0', items: [] })

  return {
    deletedCount: metadata.items.length - errors.length,
    errorCount: errors.length,
    errors: errors.length > 0 ? errors : undefined
  }
}

/**
 * 列出回收站内容
 */
async function listTrash() {
  const metadata = readMetadata()
  const { readSessionSummary } = require('./sessionUtils')

  const items = []
  for (const item of metadata.items) {
    try {
      const trashPath = path.join(TRASH_DIR, item.projectId, item.fileName)
      if (!fs.existsSync(trashPath)) {
        // 文件已丢失，跳过
        continue
      }

      // 读取 session 摘要
      const summary = await readSessionSummary(trashPath)

      // 计算剩余天数
      const expiresAt = new Date(item.expiresAt)
      const now = new Date()
      const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))

      items.push({
        projectId: item.projectId,
        sessionId: item.sessionId,
        projectName: item.projectId.replace(/^-/, '').replace(/-/g, '/'),
        firstUserMessage: summary.firstUserMessage || '(空 session)',
        messageCount: summary.messageCount,
        deletedAt: item.deletedAt,
        expiresAt: item.expiresAt,
        daysRemaining: Math.max(0, daysRemaining)
      })
    } catch {
      // 跳过无法读取的项目
    }
  }

  // 按删除时间倒序排列
  items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))

  return {
    items,
    total: items.length,
    autoDeleteDays: AUTO_DELETE_DAYS
  }
}

/**
 * 清理空目录
 */
function cleanupEmptyDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath)
      if (files.length === 0) {
        fs.rmdirSync(dirPath)
      }
    }
  } catch {
    // 忽略清理错误
  }
}

/**
 * 递归清理所有空目录
 */
function cleanupAllEmptyDirs(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(dirPath, entry.name)
        cleanupAllEmptyDirs(subPath)
      }
    }

    // 再次检查是否为空（不包括 metadata.json）
    const remaining = fs.readdirSync(dirPath).filter(f => f !== 'metadata.json')
    if (remaining.length === 0) {
      fs.rmdirSync(dirPath)
    }
  } catch {
    // 忽略清理错误
  }
}

/**
 * 清理过期项目
 */
async function cleanupExpired() {
  const metadata = readMetadata()
  const now = new Date()
  const toDelete = []
  const toKeep = []

  for (const item of metadata.items) {
    const expiresAt = new Date(item.expiresAt)
    if (expiresAt <= now) {
      toDelete.push(item)
    } else {
      toKeep.push(item)
    }
  }

  let deletedCount = 0
  for (const item of toDelete) {
    try {
      const trashPath = path.join(TRASH_DIR, item.projectId, item.fileName)
      if (fs.existsSync(trashPath)) {
        fs.unlinkSync(trashPath)
      }
      deletedCount++
    } catch {
      // 继续处理其他项目
    }
  }

  // 更新元数据
  metadata.items = toKeep
  metadata.lastCleanup = now.toISOString()
  writeMetadata(metadata)

  // 清理空目录
  cleanupAllEmptyDirs(TRASH_DIR)

  return {
    deletedCount,
    remainingCount: toKeep.length
  }
}

module.exports = {
  moveToTrash,
  restoreFromTrash,
  permanentlyDelete,
  emptyTrash,
  listTrash,
  cleanupExpired,
  TRASH_DIR,
  AUTO_DELETE_DAYS
}
