import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { connectDatabase } from './config/database.js';
import { connectRedis, setOnlineUser, removeOnlineUser, getOnlineUsers } from './config/redis.js';
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
const cors = require('cors');
// الرابط الموثوق لموقعك على Netlify
const allowedOrigin = "https://visionary-shortbread-c6623e.netlify.app";

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // أضفنا OPTIONS هنا
  credentials: true,
}));

// إعداد CORS للـ Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: allowedOrigin,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'ChatApp Server is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api', messageRoutes);
app.use('/api', groupRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api', storyRoutes);
app.use('/api', userRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', async (userId) => {
    socket.join(userId);
    await setOnlineUser(userId, socket.id);
    console.log(`User ${userId} joined their room`);
    
    const onlineUsers = await getOnlineUsers();
    io.emit('online_users', onlineUsers);
  });

  socket.on('send_message', (data) => {
    socket.to(data.recipientId).emit('receive_message', data);
  });

  socket.on('typing', (data) => {
    socket.to(data.recipientId).emit('user_typing', data);
  });

  socket.on('stop_typing', (data) => {
    socket.to(data.recipientId).emit('user_stop_typing', data);
  });

  socket.on('message_read', (data) => {
    socket.to(data.senderId).emit('message_read_receipt', data);
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    const onlineUsers = await getOnlineUsers();
    io.emit('online_users', onlineUsers);
  });
});

// Initialize connections
const initializeServer = async () => {
  try {
    await connectDatabase();
    await connectRedis();
    
    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    if (error.message && error.message.includes('database')) {
      process.exit(1);
    }
  }
};

initializeServer();

export { io };
