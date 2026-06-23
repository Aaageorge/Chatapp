import express from 'express'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import jwt from 'jsonwebtoken'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  
  console.log('Auth middleware - Token:', token ? 'exists' : 'missing')
  console.log('JWT_SECRET:', process.env.JWT_SECRET || 'using default')
  
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key')
    console.log('Token decoded successfully, userId:', decoded.userId)
    req.userId = decoded.userId
    next()
  } catch (error) {
    console.log('Token verification error:', error.message)
    return res.status(403).json({ message: 'رمز غير صالح' })
  }
}

// Ensure upload directories exist
const uploadDir = join(__dirname, '../uploads')
const imagesDir = join(uploadDir, 'images')
const videosDir = join(uploadDir, 'videos')
const filesDir = join(uploadDir, 'files')
const audioDir = join(uploadDir, 'audio')

;[uploadDir, imagesDir, videosDir, filesDir, audioDir].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
})

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let dest = uploadDir
    
    if (file.mimetype.startsWith('image/')) {
      dest = imagesDir
    } else if (file.mimetype.startsWith('video/')) {
      dest = videosDir
    } else if (file.mimetype.startsWith('audio/')) {
      dest = audioDir
    } else {
      dest = filesDir
    }
    
    cb(null, dest)
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`
    cb(null, uniqueName)
  }
})

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-rar-compressed',
  ]
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('نوع الملف غير مدعوم'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
  }
})

// Upload single file
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'لم يتم رفع ملف' })
    }

    const fileUrl = `/uploads/${req.file.mimetype.startsWith('image/') ? 'images' : 
                    req.file.mimetype.startsWith('video/') ? 'videos' :
                    req.file.mimetype.startsWith('audio/') ? 'audio' : 'files'}/${req.file.filename}`

    res.json({
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    })
  } catch (error) {
    console.error('Upload error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء رفع الملف' })
  }
})

// Upload multiple files
router.post('/upload/multiple', authenticateToken, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'لم يتم رفع ملفات' })
    }

    const files = req.files.map(file => ({
      url: `/uploads/${file.mimetype.startsWith('image/') ? 'images' : 
              file.mimetype.startsWith('video/') ? 'videos' :
              file.mimetype.startsWith('audio/') ? 'audio' : 'files'}/${file.filename}`,
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    }))

    res.json({ files })
  } catch (error) {
    console.error('Upload multiple error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء رفع الملفات' })
  }
})

// Upload voice message
router.post('/upload/voice', authenticateToken, upload.single('voice'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'لم يتم رفع رسالة صوتية' })
    }

    const fileUrl = `/uploads/audio/${req.file.filename}`

    res.json({
      url: fileUrl,
      filename: req.file.filename,
      duration: req.body.duration, // Duration in seconds
      size: req.file.size,
    })
  } catch (error) {
    console.error('Upload voice error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء رفع الرسالة الصوتية' })
  }
})

// Upload profile picture
router.post('/upload/profile-picture', authenticateToken, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'لم يتم رفع صورة' })
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'يجب رفع صورة' })
    }

    const fileUrl = `/uploads/images/${req.file.filename}`

    res.json({
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    })
  } catch (error) {
    console.error('Upload profile picture error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء رفع صورة الملف الشخصي' })
  }
})

// Delete file
router.delete('/files/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params
    
    // In production, you would delete the file from storage
    // For now, we'll just return success
    
    res.json({ message: 'تم حذف الملف' })
  } catch (error) {
    console.error('Delete file error:', error)
    res.status(500).json({ message: 'حدث خطأ أثناء حذف الملف' })
  }
})

export default router
