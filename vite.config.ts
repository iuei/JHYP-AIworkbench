/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  /**
   * 开发服务器：允许局域网访问，并把 /api 代理到后端。
   *
   * 为什么要这两项：
   * 1. Vite 默认只绑 `localhost`（回环），内网其他机器访问会直接 ERR_CONNECTION_REFUSED；
   * 2. 前端在 dev 模式用同源相对路径 `/api`（见 `.env.development`），
   *    由这里的代理转发到 API —— 浏览器侧不存在跨域，也就不必维护 CORS_ORIGIN 白名单。
   *    代理是服务端行为，因此内网访问 `http://<内网IP>:5173` 时后端仍然可达。
   */
  server: {
    host: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    silent: 'passed-only',
    unstubEnvs: true,
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      // include: ['src/**/*.{js,jsx,ts,tsx}'], // Uncomment to expand the report to all src/**/* so untested modules appear as 0% coverage.
      exclude: [
        'src/components/ui/**',
        'src/assets/**',
        'src/tanstack-table.d.ts',
        'src/routeTree.gen.ts',
        'src/test-utils/**',
        'src/routes/**',
      ],
    },
  },
})
