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

// Get conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const cacheKey = `conversations:${req.userId}`
    const cached = await getCache(cacheKey)
    
    if (cached) {
      return res.json(cached)
    }

    const result = await query(
      `SELECT DISTINCT c.id, c.type, c.name, c.avatar_url, c.description,
              MAX(m.created_at) as last_message_time,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != $1) as unread_count,
              u.username as other_username,
              u.full_name as other_full_name,
              u.avatar_url as other_avatar,
              u.is_online as other_online
       FROM conversations c
       INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
       LEFT JOIN messages m ON c.id = m.conversation_id
       LEFT JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id != $1
       LEFT JOIN users u ON cp2.user_id = u.id
       WHERE cp.user_id = $1
       GROUP BY c.id, u.username, u.full_name, u.avatar_url, u.is_online
       ORDER BY last_message_time DESC NULLS LAST`,
      [req.userId]
    )

    const conversations = result.rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.type === 'direct' ? (row.other_full_name || row.other_username || row.name) : row.name,
      avatarUrl: row.type === 'direct' ? (row.other_avatar || row.avatar_url) : row.avatar_url,
      description: row.description,
      lastMessage: row.last_message,
      lastMessageTime: row.last_message_time,
      unreadCount: parseInt(row.unread_count),
      isOnline: row.other_online,
    }))

    await setCache(cacheKey, conversations, 300) // Cache for 5 minutes

    res.json(conversations)
  } catch (error) {
    console.error('Get conversations error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب المحادثات' })
  }
})

// Get messages for a conversation
router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { limit = 50, offset = 0 } = req.query

    // Check if user is participant
    const participantCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, req.userId]
    )

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ message: 'غير مصرح بالوصول إلى هذه المحادثة' })
    }

    const result = await query(
      `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.message_type, 
              m.media_url, m.reply_to_id, m.is_pinned, m.created_at,
              u.username as sender_username, u.avatar_url as sender_avatar
       FROM messages m
       INNER JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1 AND m.is_deleted = false
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    )

    const messages = result.rows.reverse().map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderUsername: row.sender_username,
      senderAvatar: row.sender_avatar,
      content: row.content,
      messageType: row.message_type,
      mediaUrl: row.media_url,
      replyToId: row.reply_to_id,
      isPinned: row.is_pinned,
      createdAt: row.created_at,
    }))

    res.json(messages)
  } catch (error) {
    console.error('Get messages error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب الرسائل' })
  }
})

// Send message
router.post('/messages', authenticateToken, async (req, res) => {
  try {
    const { conversationId, content, messageType = 'text', mediaUrl, replyToId } = req.body

    // Check if user is participant
    const participantCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.userId]
    )

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ message: 'غير مصرح بإرسال رسائل إلى هذه المحادثة' })
    }

    const result = await query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type, media_url, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, conversation_id, sender_id, content, message_type, media_url, reply_to_id, created_at`,
      [conversationId, req.userId, content, messageType, mediaUrl || null, replyToId || null]
    )

    const message = result.rows[0]

    // Clear conversations cache
    await deleteCache(`conversations:${req.userId}`)

    res.status(201).json({
      id: message.id,
      conversationId: message.conversation_id,
      senderId: message.sender_id,
      content: message.content,
      messageType: message.message_type,
      mediaUrl: message.media_url,
      replyToId: message.reply_to_id,
      createdAt: message.created_at,
    })
  } catch (error) {
    console.error('Send message error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء إرسال الرسالة' })
  }
})

// Mark message as read
router.post('/messages/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if message exists
    const messageCheck = await query(
      'SELECT sender_id, conversation_id FROM messages WHERE id = $1',
      [id]
    )

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' })
    }

    const message = messageCheck.rows[0]

    // Don't mark own messages as read
    if (message.sender_id === req.userId) {
      return res.json({ message: 'لا يمكن تمييز رسائلك الخاصة كمقروءة' })
    }

    // Check if user is participant
    const participantCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [message.conversation_id, req.userId]
    )

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    // Insert read receipt
    await query(
      `INSERT INTO message_read_receipts (message_id, user_id, read_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP`,
      [id, req.userId]
    )

    res.json({ message: 'تم تمييز الرسالة كمقروءة' })
  } catch (error) {
    console.error('Mark as read error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تمييز الرسالة كمقروءة' })
  }
})

// Delete message
router.delete('/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { deleteForEveryone = false } = req.body

    // Check if message exists and user is sender
    const messageCheck = await query(
      'SELECT sender_id FROM messages WHERE id = $1',
      [id]
    )

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' })
    }

    const message = messageCheck.rows[0]

    if (message.sender_id !== req.userId) {
      return res.status(403).json({ message: 'غير مصرح بحذف هذه الرسالة' })
    }

    if (deleteForEveryone) {
      // Delete for everyone
      await query('UPDATE messages SET is_deleted = true WHERE id = $1', [id])
    } else {
      // Delete only for current user
      await query(
        `UPDATE messages 
         SET deleted_for = array_append(deleted_for, $1)
         WHERE id = $2`,
        [req.userId, id]
      )
    }

    res.json({ message: 'تم حذف الرسالة' })
  } catch (error) {
    console.error('Delete message error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء حذف الرسالة' })
  }
})

// Create direct conversation
router.post('/conversations', authenticateToken, async (req, res) => {
  try {
    const { type, name, participantIds } = req.body

    if (!type || !participantIds || participantIds.length === 0) {
      return res.status(400).json({ message: 'بيانات غير كاملة' })
    }

    // Add current user to participants
    const allParticipants = [...new Set([...participantIds, req.userId])]

    // For direct messages, check if conversation already exists
    if (type === 'direct' && allParticipants.length === 2) {
      const existingConv = await query(
        `SELECT c.id, c.type, c.name, c.avatar_url, c.description,
                u.username, u.full_name, u.avatar_url as user_avatar, u.is_online
         FROM conversations c
         INNER JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
         INNER JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
         INNER JOIN users u ON (cp2.user_id = u.id AND cp2.user_id != $1)
         WHERE c.type = 'direct' 
         AND cp1.user_id = $1 
         AND cp2.user_id = $2`,
        [allParticipants[0], allParticipants[1]]
      )

      if (existingConv.rows.length > 0) {
        const row = existingConv.rows[0]
        return res.json({
          id: row.id,
          type: row.type,
          name: row.name || row.full_name || row.username,
          avatarUrl: row.avatar_url || row.user_avatar,
          description: row.description,
          isOnline: row.is_online,
        })
      }
    }

    // Create conversation
    const convResult = await query(
      `INSERT INTO conversations (type, name, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [type, name || null, req.userId]
    )

    const conversationId = convResult.rows[0].id

    // Add participants
    for (const userId of allParticipants) {
      await query(
        `INSERT INTO conversation_participants (conversation_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [conversationId, userId, userId === req.userId ? 'owner' : 'member']
      )
    }

    // For direct messages, get the other user's info
    let conversationData = { id: conversationId, type, name }
    if (type === 'direct') {
      const otherUserId = allParticipants.find(id => id !== req.userId)
      const userInfo = await query(
        'SELECT username, full_name, avatar_url, is_online FROM users WHERE id = $1',
        [otherUserId]
      )
      if (userInfo.rows.length > 0) {
        const user = userInfo.rows[0]
        conversationData = {
          id: conversationId,
          type,
          name: name || user.full_name || user.username,
          avatarUrl: user.avatar_url,
          isOnline: user.is_online,
        }
      }
    }

    // Clear conversations cache
    await deleteCache(`conversations:${req.userId}`)

    res.status(201).json(conversationData)
  } catch (error) {
    console.error('Create conversation error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء إنشاء المحادثة' })
  }
})

export default router
