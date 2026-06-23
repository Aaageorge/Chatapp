import express from 'express'
import jwt from 'jsonwebtoken'
import { query } from '../config/database.js'

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

// Search users by username, full name, or phone number
router.get('/users/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'يجب إدخال نص بحث صالح' })
    }

    const searchTerm = `%${q.trim()}%`

    const result = await query(
      `SELECT id, username, full_name, phone_number, avatar_url, bio, is_online, last_seen
       FROM users
       WHERE id != $1
       AND (username ILIKE $2 OR full_name ILIKE $2 OR phone_number ILIKE $2)
       ORDER BY is_online DESC, full_name ASC
       LIMIT 20`,
      [req.userId, searchTerm]
    )

    const users = result.rows.map(row => ({
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      phoneNumber: row.phone_number,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      isOnline: row.is_online,
      lastSeen: row.last_seen,
    }))

    res.json(users)
  } catch (error) {
    console.error('Search users error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء البحث عن المستخدمين' })
  }
})

// Get all users (for new chat modal)
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query

    const result = await query(
      `SELECT id, username, full_name, phone_number, avatar_url, bio, is_online, last_seen
       FROM users
       WHERE id != $1
       ORDER BY is_online DESC, full_name ASC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    )

    const users = result.rows.map(row => ({
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      phoneNumber: row.phone_number,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      isOnline: row.is_online,
      lastSeen: row.last_seen,
    }))

    res.json(users)
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب المستخدمين' })
  }
})

// Get user by ID
router.get('/users/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await query(
      `SELECT id, username, full_name, phone_number, avatar_url, bio, is_online, last_seen, created_at
       FROM users
       WHERE id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'المستخدم غير موجود' })
    }

    const user = result.rows[0]

    res.json({
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      isOnline: user.is_online,
      lastSeen: user.last_seen,
      createdAt: user.created_at,
    })
  } catch (error) {
    console.error('Get user error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب بيانات المستخدم' })
  }
})

// Update user profile
router.put('/users/profile', authenticateToken, async (req, res) => {
  try {
    const { username, fullName, bio } = req.body

    // Check if username is already taken by another user
    if (username) {
      const existingUser = await query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, req.userId]
      )
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ message: 'اسم المستخدم محجوز بالفعل' })
      }
    }

    const result = await query(
      `UPDATE users
       SET username = COALESCE($1, username),
           full_name = COALESCE($2, full_name),
           bio = COALESCE($3, bio)
       WHERE id = $4
       RETURNING id, username, full_name, phone_number, avatar_url, bio`,
      [username, fullName, bio, req.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'المستخدم غير موجود' })
    }

    const user = result.rows[0]

    res.json({
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      avatarUrl: user.avatar_url,
      bio: user.bio,
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث الملف الشخصي' })
  }
})

// Update user avatar
router.put('/users/avatar', authenticateToken, async (req, res) => {
  try {
    const { avatarUrl } = req.body

    if (!avatarUrl) {
      return res.status(400).json({ message: 'رابط الصورة مطلوب' })
    }

    const result = await query(
      `UPDATE users
       SET avatar_url = $1
       WHERE id = $2
       RETURNING id, username, full_name, phone_number, avatar_url, bio`,
      [avatarUrl, req.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'المستخدم غير موجود' })
    }

    const user = result.rows[0]

    res.json({
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      avatarUrl: user.avatar_url,
      bio: user.bio,
    })
  } catch (error) {
    console.error('Update avatar error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث صورة الملف الشخصي' })
  }
})

// Get user privacy settings
router.get('/users/privacy', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM user_privacy_settings WHERE user_id = $1`,
      [req.userId]
    )

    if (result.rows.length === 0) {
      // Create default privacy settings if not exist
      const insertResult = await query(
        `INSERT INTO user_privacy_settings (user_id) 
         VALUES ($1) 
         RETURNING *`,
        [req.userId]
      )
      return res.json({
        lastSeen: insertResult.rows[0].last_seen_visibility,
        profilePhoto: insertResult.rows[0].profile_photo_visibility,
        status: insertResult.rows[0].status_visibility,
        calls: insertResult.rows[0].calls_visibility,
        forwardMessages: insertResult.rows[0].forward_messages,
        showPhoneNumber: insertResult.rows[0].show_phone_number,
      })
    }

    const settings = result.rows[0]

    res.json({
      lastSeen: settings.last_seen_visibility,
      profilePhoto: settings.profile_photo_visibility,
      status: settings.status_visibility,
      calls: settings.calls_visibility,
      forwardMessages: settings.forward_messages,
      showPhoneNumber: settings.show_phone_number,
    })
  } catch (error) {
    console.error('Get privacy settings error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب إعدادات الخصوصية' })
  }
})

// Update user privacy settings
router.put('/users/privacy', authenticateToken, async (req, res) => {
  try {
    const { lastSeen, profilePhoto, status, calls, forwardMessages, showPhoneNumber } = req.body

    const result = await query(
      `UPDATE user_privacy_settings
       SET last_seen_visibility = COALESCE($1, last_seen_visibility),
           profile_photo_visibility = COALESCE($2, profile_photo_visibility),
           status_visibility = COALESCE($3, status_visibility),
           calls_visibility = COALESCE($4, calls_visibility),
           forward_messages = COALESCE($5, forward_messages),
           show_phone_number = COALESCE($6, show_phone_number),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $7
       RETURNING *`,
      [lastSeen, profilePhoto, status, calls, forwardMessages, showPhoneNumber, req.userId]
    )

    if (result.rows.length === 0) {
      // Insert if not exists
      const insertResult = await query(
        `INSERT INTO user_privacy_settings 
         (user_id, last_seen_visibility, profile_photo_visibility, status_visibility, calls_visibility, forward_messages, show_phone_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.userId, lastSeen || 'everyone', profilePhoto || 'everyone', status || 'contacts', calls || 'contacts', forwardMessages !== undefined ? forwardMessages : true, showPhoneNumber !== undefined ? showPhoneNumber : true]
      )
      return res.json({
        lastSeen: insertResult.rows[0].last_seen_visibility,
        profilePhoto: insertResult.rows[0].profile_photo_visibility,
        status: insertResult.rows[0].status_visibility,
        calls: insertResult.rows[0].calls_visibility,
        forwardMessages: insertResult.rows[0].forward_messages,
        showPhoneNumber: insertResult.rows[0].show_phone_number,
      })
    }

    const settings = result.rows[0]

    res.json({
      lastSeen: settings.last_seen_visibility,
      profilePhoto: settings.profile_photo_visibility,
      status: settings.status_visibility,
      calls: settings.calls_visibility,
      forwardMessages: settings.forward_messages,
      showPhoneNumber: settings.show_phone_number,
    })
  } catch (error) {
    console.error('Update privacy settings error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث إعدادات الخصوصية' })
  }
})

// Get user notification settings
router.get('/users/notifications', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM user_notification_settings WHERE user_id = $1`,
      [req.userId]
    )

    if (result.rows.length === 0) {
      // Create default notification settings if not exist
      const insertResult = await query(
        `INSERT INTO user_notification_settings (user_id) 
         VALUES ($1) 
         RETURNING *`,
        [req.userId]
      )
      return res.json({
        messageNotifications: insertResult.rows[0].message_notifications,
        groupNotifications: insertResult.rows[0].group_notifications,
        sound: insertResult.rows[0].sound_enabled,
        vibration: insertResult.rows[0].vibration_enabled,
        previewMessages: insertResult.rows[0].preview_messages,
        notificationSound: insertResult.rows[0].notification_sound,
      })
    }

    const settings = result.rows[0]

    res.json({
      messageNotifications: settings.message_notifications,
      groupNotifications: settings.group_notifications,
      sound: settings.sound_enabled,
      vibration: settings.vibration_enabled,
      previewMessages: settings.preview_messages,
      notificationSound: settings.notification_sound,
    })
  } catch (error) {
    console.error('Get notification settings error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب إعدادات الإشعارات' })
  }
})

// Update user notification settings
router.put('/users/notifications', authenticateToken, async (req, res) => {
  try {
    const { messageNotifications, groupNotifications, sound, vibration, previewMessages, notificationSound } = req.body

    const result = await query(
      `UPDATE user_notification_settings
       SET message_notifications = COALESCE($1, message_notifications),
           group_notifications = COALESCE($2, group_notifications),
           sound_enabled = COALESCE($3, sound_enabled),
           vibration_enabled = COALESCE($4, vibration_enabled),
           preview_messages = COALESCE($5, preview_messages),
           notification_sound = COALESCE($6, notification_sound),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $7
       RETURNING *`,
      [messageNotifications, groupNotifications, sound, vibration, previewMessages, notificationSound, req.userId]
    )

    if (result.rows.length === 0) {
      // Insert if not exists
      const insertResult = await query(
        `INSERT INTO user_notification_settings 
         (user_id, message_notifications, group_notifications, sound_enabled, vibration_enabled, preview_messages, notification_sound)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.userId, messageNotifications !== undefined ? messageNotifications : true, groupNotifications !== undefined ? groupNotifications : true, sound !== undefined ? sound : true, vibration !== undefined ? vibration : true, previewMessages !== undefined ? previewMessages : true, notificationSound || 'default']
      )
      return res.json({
        messageNotifications: insertResult.rows[0].message_notifications,
        groupNotifications: insertResult.rows[0].group_notifications,
        sound: insertResult.rows[0].sound_enabled,
        vibration: insertResult.rows[0].vibration_enabled,
        previewMessages: insertResult.rows[0].preview_messages,
        notificationSound: insertResult.rows[0].notification_sound,
      })
    }

    const settings = result.rows[0]

    res.json({
      messageNotifications: settings.message_notifications,
      groupNotifications: settings.group_notifications,
      sound: settings.sound_enabled,
      vibration: settings.vibration_enabled,
      previewMessages: settings.preview_messages,
      notificationSound: settings.notification_sound,
    })
  } catch (error) {
    console.error('Update notification settings error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث إعدادات الإشعارات' })
  }
})

// Get user chat settings
router.get('/users/chat-settings', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM user_chat_settings WHERE user_id = $1`,
      [req.userId]
    )

    if (result.rows.length === 0) {
      // Create default chat settings if not exist
      const insertResult = await query(
        `INSERT INTO user_chat_settings (user_id) 
         VALUES ($1) 
         RETURNING *`,
        [req.userId]
      )
      return res.json({
        chatBackground: insertResult.rows[0].chat_background,
        textSize: insertResult.rows[0].text_size,
        autoDownloadMedia: insertResult.rows[0].auto_download_media,
        saveToGallery: insertResult.rows[0].save_to_gallery,
      })
    }

    const settings = result.rows[0]

    res.json({
      chatBackground: settings.chat_background,
      textSize: settings.text_size,
      autoDownloadMedia: settings.auto_download_media,
      saveToGallery: settings.save_to_gallery,
    })
  } catch (error) {
    console.error('Get chat settings error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب إعدادات المحادثة' })
  }
})

// Update user chat settings
router.put('/users/chat-settings', authenticateToken, async (req, res) => {
  try {
    const { chatBackground, textSize, autoDownloadMedia, saveToGallery } = req.body

    const result = await query(
      `UPDATE user_chat_settings
       SET chat_background = COALESCE($1, chat_background),
           text_size = COALESCE($2, text_size),
           auto_download_media = COALESCE($3, auto_download_media),
           save_to_gallery = COALESCE($4, save_to_gallery),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $5
       RETURNING *`,
      [chatBackground, textSize, autoDownloadMedia, saveToGallery, req.userId]
    )

    if (result.rows.length === 0) {
      // Insert if not exists
      const insertResult = await query(
        `INSERT INTO user_chat_settings 
         (user_id, chat_background, text_size, auto_download_media, save_to_gallery)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [req.userId, chatBackground || 'default', textSize || 'medium', autoDownloadMedia !== undefined ? autoDownloadMedia : true, saveToGallery !== undefined ? saveToGallery : true]
      )
      return res.json({
        chatBackground: insertResult.rows[0].chat_background,
        textSize: insertResult.rows[0].text_size,
        autoDownloadMedia: insertResult.rows[0].auto_download_media,
        saveToGallery: insertResult.rows[0].save_to_gallery,
      })
    }

    const settings = result.rows[0]

    res.json({
      chatBackground: settings.chat_background,
      textSize: settings.text_size,
      autoDownloadMedia: settings.auto_download_media,
      saveToGallery: settings.save_to_gallery,
    })
  } catch (error) {
    console.error('Update chat settings error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث إعدادات المحادثة' })
  }
})

export default router
