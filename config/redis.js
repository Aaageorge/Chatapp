import { createClient } from 'redis'

// In-memory storage as fallback
const memoryStorage = {
  onlineUsers: new Map(),
  cache: new Map(),
}

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    reconnectStrategy: (retries) => {
      // Disable automatic reconnection
      return new Error('Reconnection disabled');
    },
  },
  password: process.env.REDIS_PASSWORD || undefined,
})

let redisConnected = false

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err)
  redisConnected = false
})

redisClient.on('connect', () => {
  console.log('Connected to Redis')
  redisConnected = true
})

export const connectRedis = async () => {
  try {
    await redisClient.connect()
    redisConnected = true
  } catch (error) {
    console.warn('Failed to connect to Redis, using in-memory storage:', error.message)
    redisConnected = false
    // Don't throw error, allow server to start with memory storage
  }
}

export const setCache = async (key, value, expiration = 3600) => {
  if (redisConnected) {
    try {
      await redisClient.setEx(key, expiration, JSON.stringify(value))
    } catch (error) {
      console.error('Redis set error:', error)
    }
  } else {
    // Use in-memory storage
    memoryStorage.cache.set(key, value)
    // Set timeout to expire (simplified - doesn't handle exact expiration)
    setTimeout(() => {
      memoryStorage.cache.delete(key)
    }, expiration * 1000)
  }
}

export const getCache = async (key) => {
  if (redisConnected) {
    try {
      const data = await redisClient.get(key)
      return data ? JSON.parse(data) : null
    } catch (error) {
      console.error('Redis get error:', error)
      return null
    }
  } else {
    // Use in-memory storage
    return memoryStorage.cache.get(key) || null
  }
}

export const deleteCache = async (key) => {
  if (redisConnected) {
    try {
      await redisClient.del(key)
    } catch (error) {
      console.error('Redis delete error:', error)
    }
  } else {
    // Use in-memory storage
    memoryStorage.cache.delete(key)
  }
}

export const setOnlineUser = async (userId, socketId) => {
  if (redisConnected) {
    try {
      await redisClient.hSet('online_users', userId, socketId)
      await redisClient.setEx(`user:${userId}:online`, 3600, 'true')
    } catch (error) {
      console.error('Redis set online user error:', error)
    }
  } else {
    // Use in-memory storage
    memoryStorage.onlineUsers.set(userId, socketId)
  }
}

export const removeOnlineUser = async (userId) => {
  if (redisConnected) {
    try {
      await redisClient.hDel('online_users', userId)
      await redisClient.del(`user:${userId}:online`)
    } catch (error) {
      console.error('Redis remove online user error:', error)
    }
  } else {
    // Use in-memory storage
    memoryStorage.onlineUsers.delete(userId)
  }
}

export const getOnlineUsers = async () => {
  if (redisConnected) {
    try {
      const onlineUsers = await redisClient.hGetAll('online_users')
      return Object.keys(onlineUsers)
    } catch (error) {
      console.error('Redis get online users error:', error)
      return []
    }
  } else {
    // Use in-memory storage
    return Array.from(memoryStorage.onlineUsers.keys())
  }
}

export const isUserOnline = async (userId) => {
  if (redisConnected) {
    try {
      const isOnline = await redisClient.get(`user:${userId}:online`)
      return isOnline === 'true'
    } catch (error) {
      console.error('Redis check user online error:', error)
      return false
    }
  } else {
    // Use in-memory storage
    return memoryStorage.onlineUsers.has(userId)
  }
}

export default redisClient
