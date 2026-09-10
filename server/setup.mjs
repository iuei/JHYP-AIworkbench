import pg from 'pg'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { runNavigationMigrations } from './navigation-migrations.mjs'

dotenv.config()
const database = process.env.PGDATABASE ?? 'jhyp_workbench'
const options = { host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD }
const admin = new pg.Client({ ...options, database: 'postgres' })
await admin.connect()
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
if (!exists.rowCount) await admin.query(`CREATE DATABASE "${database.replaceAll('"', '')}"`)
await admin.end()

const client = new pg.Client({ ...options, database })
await client.connect()
await client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, login VARCHAR(120) UNIQUE NOT NULL, name VARCHAR(80) NOT NULL,
    password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'operator', status VARCHAR(20) NOT NULL DEFAULT 'enabled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS shortcut_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, shortcut_ids JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS work_items (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, module VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL, progress INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100), route VARCHAR(200) NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS competitor_analyses (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, input_type VARCHAR(20) NOT NULL,
    input_value VARCHAR(200) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`)
const login = process.env.INITIAL_ADMIN_LOGIN
const password = process.env.INITIAL_ADMIN_PASSWORD
if (login && password) {
  const hash = await bcrypt.hash(password, 12)
  await client.query(`INSERT INTO users (login, name, password_hash, role) VALUES ($1, '系统管理员', $2, 'admin') ON CONFLICT (login) DO NOTHING`, [login, hash])
}

await runNavigationMigrations(client)
await client.end()
process.stdout.write('数据库初始化完成。\n')
