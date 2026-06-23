import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'chatapp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
})

const setupDatabase = async () => {
  try {
    console.log('Connecting to database...')
    await pool.connect()
    console.log('Connected to database')

    console.log('Reading schema.sql file...')
    const schemaPath = path.join(__dirname, 'database', 'schema.sql')
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8')

    console.log('Executing schema...')
    await pool.query(schemaSQL)
    console.log('Database schema created successfully!')

    await pool.end()
    console.log('Database connection closed')
    process.exit(0)
  } catch (error) {
    console.error('Error setting up database:', error)
    await pool.end()
    process.exit(1)
  }
}

setupDatabase()
