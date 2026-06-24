import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
// ... (قم باستيراد باقي الـ routes الخاصة بك هنا)

dotenv.config();

const app = express();
const httpServer = createServer(app);
const allowedOrigin = "https://visionary-shortbread-c6623e.netlify.app";

// 1. الإعداد الصحيح للـ CORS (يجب أن يكون قبل أي route)
app.use(cors({
  origin: allowedOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));

app.use(express.json());

// 2. إعداد Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ... (ضع الـ routes هنا: app.use('/api/auth', authRoutes); إلخ)

// 3. الاستماع للمنفذ
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
