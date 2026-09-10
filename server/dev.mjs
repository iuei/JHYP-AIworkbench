import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = [
  spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SERVE_STATIC: 'false' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    cwd: root,
    stdio: 'inherit',
  }),
]

function shutdown() {
  for (const child of children) child.kill()
  process.exit()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await new Promise(() => {})
