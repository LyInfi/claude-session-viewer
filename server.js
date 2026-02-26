const express = require('express')
const path = require('path')
const routes = require('./src/routes')
const { cleanupExpired } = require('./src/trash')

const app = express()
const PORT = process.env.PORT || 3456
const HOST = '127.0.0.1'

app.use(express.json())

// 静态文件
app.use(express.static(path.join(__dirname, 'public')))

// API 路由
app.use('/api', routes)

// 前端路由 fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, HOST, () => {
  console.log(`\n✅ Claude Session Viewer 已启动`)
  console.log(`   访问地址: http://${HOST}:${PORT}\n`)

  // 启动后延迟执行回收站清理
  setTimeout(async () => {
    try {
      const result = await cleanupExpired()
      if (result.deletedCount > 0) {
        console.log(`🗑️  自动清理: 已删除 ${result.deletedCount} 个过期 session`)
      }
    } catch (err) {
      console.error('回收站清理失败:', err.message)
    }
  }, 5000)
})
