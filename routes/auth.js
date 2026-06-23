import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../config/database.js'
import { setCache, deleteCache } from '../config/redis.js'

const router = express.Router()

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, phoneNumber, email, password, fullName } = req.body

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1 OR phone_number = $2',
      [username, phoneNumber]
    )

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'اسم المستخدم أو رقم الهاتف مستخدم بالفعل' })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user
    const result = await query(
      `INSERT INTO users (username, phone_number, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, phone_number, email, full_name, avatar_url, bio`,
      [username, phoneNumber, email || null, hashedPassword, fullName || null]
    )

    const user = result.rows[0]

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    )

    // Cache user data
    await setCache(`user:${user.id}`, user)

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        phoneNumber: user.phone_number,
        email: user.email,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
      },
    })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء التسجيل' })
  }
})

// Login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body

    // Find user by phone number or email
    const result = await query(
      'SELECT * FROM users WHERE phone_number = $1 OR email = $1',
      [identifier]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    const user = result.rows[0]

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash)

    if (!isValidPassword) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    // Update last seen
    await query(
      'UPDATE users SET last_seen = CURRENT_TIMESTAMP, is_online = true WHERE id = $1',
      [user.id]
    )

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    )

    // Cache user data
    await setCache(`user:${user.id}`, user)

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        phoneNumber: user.phone_number,
        email: user.email,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تسجيل الدخول' })
  }
})

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ message: 'غير مصرح' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key')

    const result = await query(
      'SELECT id, username, phone_number, email, full_name, avatar_url, bio, is_online, last_seen FROM users WHERE id = $1',
      [decoded.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'المستخدم غير موجود' })
    }

    const user = result.rows[0]

    res.json({
      id: user.id,
      username: user.username,
      phoneNumber: user.phone_number,
      email: user.email,
      fullName: user.full_name,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      isOnline: user.is_online,
      lastSeen: user.last_seen,
    })
  } catch (error) {
    console.error('Get user error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء جلب بيانات المستخدم' })
  }
})

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ message: 'غير مصرح' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key')
    const { fullName, bio, avatarUrl } = req.body

    const result = await query(
      `UPDATE users 
       SET full_name = COALESCE($1, full_name),
           bio = COALESCE($2, bio),
           avatar_url = COALESCE($3, avatar_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, username, phone_number, email, full_name, avatar_url, bio`,
      [fullName, bio, avatarUrl, decoded.userId]
    )

    const user = result.rows[0]

    // Update cache
    await setCache(`user:${user.id}`, user)

    res.json({
      id: user.id,
      username: user.username,
      phoneNumber: user.phone_number,
      email: user.email,
      fullName: user.full_name,
      avatarUrl: user.avatar_url,
      bio: user.bio,
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث الملف الشخصي' })
  }
})

// Logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ message: 'غير مصرح' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key')

    // Update last seen and online status
    await query(
      'UPDATE users SET is_online = false, last_seen = CURRENT_TIMESTAMP WHERE id = $1',
      [decoded.userId]
    )

    // Clear cache
    await deleteCache(`user:${decoded.userId}`)

    res.json({ message: 'تم تسجيل الخروج بنجاح' })
  } catch (error) {
    console.error('Logout error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء تسجيل الخروج' })
  }
})

export default router
