import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

loadEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const rootDir = path.resolve(__dirname, '..')

const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret) {
  throw new Error('JWT_SECRET wajib diisi di .env')
}

// Vercel tidak mengizinkan penulisan ke filesystem aplikasi.
// Untuk TESTING saja, gunakan /tmp.
const isVercel = Boolean(process.env.VERCEL)

const dataDir = isVercel
  ? '/tmp/web-blast-data'
  : path.join(rootDir, 'data')

export const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret,
  superAdminUser: process.env.SUPER_ADMIN_USER || 'superadmin',
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD || 'superadmin123',

  dataDir,
  dbPath: path.join(dataDir, 'app.sqlite'),
  sessionsDir: path.join(dataDir, 'sessions'),

  publicDir: path.join(rootDir, 'public')
}