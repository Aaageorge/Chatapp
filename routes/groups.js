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

// Check if user is admin or owner
const checkAdmin = async (conversationId, userId) => {
  const result = await query(
    'SELECT role FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId]
  )
  
  if (result.rows.length === 0) {
    return false
  }
  
  const role = result.rows[0].role
  return role === 'owner' || role === 'admin'
}

// Create group
router.post('/groups', authenticateToken, async (req, res) => {
  try {
    const { name, description, avatarUrl, participantIds } = req.body

    if (!name) {
      return res.status(400).json({ message: 'اسم المجموعة مطلوب' })
    }

    const allParticipants = [...new Set([...(participantIds || []), req.userId])]

    // Create group conversation
    const convResult = await query(
      `INSERT INTO conversations (type, name, description, avatar_url, created_by)
       VALUES ('group', $1, $2, $3, $4)
       RETURNING id`,
      [name, description || null, avatarUrl || null, req.userId]
    )

    const groupId = convResult.rows[0].id

    // Add participants
    for (const userId of allParticipants) {
      await query(
        `INSERT INTO conversation_participants (conversation_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [groupId, userId, userId === req.userId ? 'owner' : 'member']
      )
    }

    res.status(201).json({ id: groupId })
  } catch (error) {
    console.error('Create group error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء إنشاء المجموعة' })
  }
})

// Create channel
router.post('/channels', authenticateToken, async (req, res) => {
  try {
    const { name, description, avatarUrl, isPublic = false } = req.body

    if (!name) {
      return res.status(400).json({ message: 'اسم القناة مطلوب' })
    }

    // Create channel conversation
    const convResult = await query(
      `INSERT INTO conversations (type, name, description, avatar_url, created_by)
       VALUES ('channel', $1, $2, $3, $4)
       RETURNING id`,
      [name, description || null, avatarUrl || null, req.userId]
    )

    const channelId = convResult.rows[0].id

    // Add creator as owner
    await query(
      `INSERT INTO conversation_participants (conversation_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [channelId, req.userId, 'owner']
    )

    res.status(201).json({ id: channelId })
  } catch (error) {
    console.error('Create channel error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء إنشاء القناة' })
  }
})

// Add participant to group/channel
router.post('/groups/:id/participants', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { userIds } = req.body

    if (!userIds || userIds.length === 0) {
      return res.status(400).json({ message: 'يجب تحديد مستخدمين' })
    }

    // Check if user is admin
    const isAdmin = await checkAdmin(id, req.userId)
    if (!isAdmin) {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    // Add participants
    for (const userId of userIds) {
      await query(
        `INSERT INTO conversation_participants (conversation_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [id, userId, 'member']
      )
    }

    res.json({ message: 'تمت إضافة المشاركين' })
  } catch (error) {
    console.error('Add participants error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء إضافة المشاركين' })
  }
})

// Remove participant from group/channel
router.delete('/groups/:id/participants/:userId', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params

    // Check if user is admin
    const isAdmin = await checkAdmin(id, req.userId)
    if (!isAdmin) {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    // Remove participant
    await query(
      'DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, userId]
    )

    res.json({ message: 'تمت إزالة المشارك' })
  } catch (error) {
    console.error('Remove participant error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء إزالة المشارك' })
  }
})

// Update participant role
router.put('/groups/:id/participants/:userId/role', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params
    const { role } = req.body

    if (!['owner', 'admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'دور غير صالح' })
    }

    // Check if user is owner
    const ownerCheck = await query(
      'SELECT role FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, req.userId]
    )

    if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].role !== 'owner') {
      return res.status(403).json({ message: 'فقط المالك يمكنه تغيير الأدوار' })
    }

    // Update role
    await query(
      `UPDATE conversation_participants 
       SET role = $1 
       WHERE conversation_id = $2 AND user_id = $3`,
      [role, id, userId]
    )

    res.json({ message: 'تم تحديث الدور' })
  } catch (error) {
    console.error('Update role error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث الدور' })
  }
})

// Get group/channel participants
router.get('/groups/:id/participants', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if user is participant
    const participantCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, req.userId]
    )

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    const result = await query(
      `SELECT cp.user_id, cp.role, cp.joined_at,
              u.username, u.full_name, u.avatar_url
       FROM conversation_participants cp
       INNER JOIN users u ON cp.user_id = u.id
       WHERE cp.conversation_id = $1
       ORDER BY cp.joined_at`,
      [id]
    )

    const participants = result.rows.map(row => ({
      userId: row.user_id,
      username: row.username,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      role: row.role,
      joinedAt: row.joined_at,
    }))

    res.json(participants)
  } catch (error) {
    console.error('Get participants error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب المشاركين' })
  }
})

// Update group/channel
router.put('/groups/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, avatarUrl } = req.body

    // Check if user is admin
    const isAdmin = await checkAdmin(id, req.userId)
    if (!isAdmin) {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    // Update conversation
    await query(
      `UPDATE conversations 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           avatar_url = COALESCE($3, avatar_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [name, description, avatarUrl, id]
    )

    res.json({ message: 'تم تحديث المجموعة/القناة' })
  } catch (error) {
    console.error('Update group error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء التحديث' })
  }
})

// Delete group/channel
router.delete('/groups/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if user is owner
    const ownerCheck = await query(
      'SELECT role FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, req.userId]
    )

    if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].role !== 'owner') {
      return res.status(403).json({ message: 'فقط المالك يمكنه حذف المجموعة/القناة' })
    }

    // Delete conversation (cascade will handle related records)
    await query('DELETE FROM conversations WHERE id = $1', [id])

    res.json({ message: 'تم حذف المجموعة/القناة' })
  } catch (error) {
    console.error('Delete group error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء الحذف' })
  }
})

// Leave group/channel
router.post('/groups/:id/leave', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if user is participant
    const participantCheck = await query(
      'SELECT role FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, req.userId]
    )

    if (participantCheck.rows.length === 0) {
      return res.status(404).json({ message: 'المستخدم ليس مشاركاً' })
    }

    // Owner cannot leave
    if (participantCheck.rows[0].role === 'owner') {
      return res.status(400).json({ message: 'المالك لا يمكنه مغادرة المجموعة' })
    }

    // Remove participant
    await query(
      'DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, req.userId]
    )

    res.json({ message: 'تم مغادرة المجموعة' })
  } catch (error) {
    console.error('Leave group error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء مغادرة المجموعة' })
  }
})

export default router
