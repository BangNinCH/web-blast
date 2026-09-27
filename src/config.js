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

export const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret,
  superAdminUser: process.env.SUPER_ADMIN_USER || 'superadmin',
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD || 'superadmin123',
  dataDir: path.join(rootDir, 'data'),
  dbPath: path.join(rootDir, 'data', 'app.sqlite'),
  sessionsDir: path.join(rootDir, 'data', 'sessions'),
  publicDir: path.join(rootDir, 'public')
}
