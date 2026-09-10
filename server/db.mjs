import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

export const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'jhyp_workbench',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
})

export async function query(text, params) {
  return pool.query(text, params)
}
