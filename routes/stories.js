import express from 'express'
import jwt from 'jsonwebtoken'
import { query } from '../config/database.js'
import { setCache, getCache, deleteCache } from '../config/redis.js'

const router = express.Router()

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key')
    req.userId = decoded.userId
    next()
  } catch (error) {
    return res.status(403).json({ message: 'رمز غير صالح' })
  }
}

// Create story
router.post('/stories', authenticateToken, async (req, res) => {
  try {
    const { mediaUrl, caption, mediaType } = req.body

    if (!mediaUrl) {
      return res.status(400).json({ message: 'رابط الوسائط مطلوب' })
    }

    const result = await query(
      `INSERT INTO stories (user_id, media_url, caption, media_type, expires_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '24 hours')
       RETURNING id, media_url, caption, media_type, created_at, expires_at`,
      [req.userId, mediaUrl, caption || null, mediaType || 'image']
    )

    const story = result.rows[0]

    res.status(201).json({
      id: story.id,
      mediaUrl: story.media_url,
      caption: story.caption,
      mediaType: story.media_type,
      createdAt: story.created_at,
      expiresAt: story.expires_at,
    })
  } catch (error) {
    console.error('Create story error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء إنشاء الحالة' })
  }
})

// Get stories from contacts
router.get('/stories', authenticateToken, async (req, res) => {
  try {
    const cacheKey = `stories:${req.userId}`
    const cached = await getCache(cacheKey)
    
    if (cached) {
      return res.json(cached)
    }

    // Get stories from user's contacts (for now, get all stories except own)
    const result = await query(
      `SELECT s.id, s.user_id, s.media_url, s.caption, s.media_type, 
              s.created_at, s.expires_at, s.viewers,
              u.username, u.full_name, u.avatar_url
       FROM stories s
       INNER JOIN users u ON s.user_id = u.id
       WHERE s.expires_at > CURRENT_TIMESTAMP
       AND s.user_id != $1
       ORDER BY s.created_at DESC`,
      [req.userId]
    )

    const stories = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      mediaUrl: row.media_url,
      caption: row.caption,
      mediaType: row.media_type,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      viewed: row.viewers.includes(req.userId),
    }))

    await setCache(cacheKey, stories, 60) // Cache for 1 minute

    res.json(stories)
  } catch (error) {
    console.error('Get stories error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب الحالات' })
  }
})

// Get user's own stories
router.get('/stories/my', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, media_url, caption, media_type, created_at, expires_at, viewers
       FROM stories
       WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC`,
      [req.userId]
    )

    const stories = result.rows.map(row => ({
      id: row.id,
      mediaUrl: row.media_url,
      caption: row.caption,
      mediaType: row.media_type,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      viewCount: row.viewers.length,
    }))

    res.json(stories)
  } catch (error) {
    console.error('Get my stories error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب حالاتك' })
  }
})

// View story
router.post('/stories/:id/view', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if story exists
    const storyCheck = await query(
      'SELECT user_id, viewers FROM stories WHERE id = $1',
      [id]
    )

    if (storyCheck.rows.length === 0) {
      return res.status(404).json({ message: 'الحالة غير موجودة' })
    }

    const story = storyCheck.rows[0]

    // Don't view own story
    if (story.user_id === req.userId) {
      return res.json({ message: 'لا يمكن عرض حالتك الخاصة' })
    }

    // Add viewer if not already viewed
    if (!story.viewers.includes(req.userId)) {
      await query(
        `UPDATE stories 
         SET viewers = array_append(viewers, $1)
         WHERE id = $2`,
        [req.userId, id]
      )
    }

    res.json({ message: 'تم تسجيل المشاهدة' })
  } catch (error) {
    console.error('View story error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تسجيل المشاهدة' })
  }
})

// Delete story
router.delete('/stories/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if story exists and user is owner
    const storyCheck = await query(
      'SELECT user_id FROM stories WHERE id = $1',
      [id]
    )

    if (storyCheck.rows.length === 0) {
      return res.status(404).json({ message: 'الحالة غير موجودة' })
    }

    if (storyCheck.rows[0].user_id !== req.userId) {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    // Delete story
    await query('DELETE FROM stories WHERE id = $1', [id])

    res.json({ message: 'تم حذف الحالة' })
  } catch (error) {
    console.error('Delete story error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء حذف الحالة' })
  }
})

// Get story viewers
router.get('/stories/:id/viewers', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if story exists and user is owner
    const storyCheck = await query(
      'SELECT user_id, viewers FROM stories WHERE id = $1',
      [id]
    )

    if (storyCheck.rows.length === 0) {
      return res.status(404).json({ message: 'الحالة غير موجودة' })
    }

    if (storyCheck.rows[0].user_id !== req.userId) {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    const viewers = storyCheck.rows[0].viewers

    if (viewers.length === 0) {
      return res.json([])
    }

    // Get viewer details
    const result = await query(
      `SELECT id, username, full_name, avatar_url
       FROM users
       WHERE id = ANY($1)`,
      [viewers]
    )

    const viewerDetails = result.rows.map(row => ({
      userId: row.id,
      username: row.username,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
    }))

    res.json(viewerDetails)
  } catch (error) {
    console.error('Get viewers error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب المشاهدين' })
  }
})

export default router
