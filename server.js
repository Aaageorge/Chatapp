import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// استيراد الإعدادات والـ Routes
import { connectDatabase } from './config/database.js';
import { connectRedis, setOnlineUser, getOnlineUsers } from './config/redis.js';
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/messages.js';
import groupRoutes from './routes/groups.js';
import mediaRoutes from './routes/media.js';
import storyRoutes from './routes/stories.js';
import userRoutes from './routes/users.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
// 1. إعدادات CORS المتكاملة
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// معالجة طلبات الـ Preflight بشكل صريح — يجب أن يكون قبل أي Route
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// 2. Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// 3. إعداد Socket.io مع CORS
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// 4. Routes
app.get('/', (req, res) => {
  res.json({ message: 'ChatApp Server is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api', messageRoutes);
app.use('/api', groupRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api', storyRoutes);
app.use('/api', userRoutes);

// 5. Socket.io Logic
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.on('join', async (userId) => {
    socket.join(userId);
    await setOnlineUser(userId, socket.id);
    io.emit('online_users', await getOnlineUsers());
  });
  socket.on('disconnect', async () => {
    io.emit('online_users', await getOnlineUsers());
  });
});

// 6. تشغيل السيرفر
const PORT = process.env.PORT || 8080;
const initializeServer = async () => {
  try {
    await connectDatabase();
    // إذا كنت لا تزال تواجه مشكلة مع Redis، ابقِ هذا السطر معلقاً
    await connectRedis().catch(err => console.log("Redis optional connection failed"));
    
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
  }
};

initializeServer();

export { io };
