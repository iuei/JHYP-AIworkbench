/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'

/**
 * 本机 Playwright chromium 缺失时的替代跑测入口（`pnpm test` 走 `vite.config.ts`，需要下载浏览器）：
 *
 *   npx vitest run --config vitest.chrome.config.ts --browser.headless
 *
 * 一台机器上只有系统 Chrome（`channel: 'chrome'`）时用这个配置；插件必须与
 * `vite.config.ts` 逐项一致——少了 `tailwindcss()`，布局 / 断点类断言会因为
 * 样式没生成而假失败（踩过：dashboard 的 grid 列数断言）。
 */
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    silent: 'passed-only',
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { channel: 'chrome' } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
