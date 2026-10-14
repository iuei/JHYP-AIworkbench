import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // shadcn/ui 基座由上游维护，其导出按需被各页取用，不参与"未使用"判定
  ignore: ['src/components/ui/**', 'src/tanstack-table.d.ts'],
  /*
   * 人工运行的脚本与全局声明不是"死代码"，它们只是没有 import 关系 ——
   * knip 只认模块图，于是把 20 个验收脚本 + 7 个评测脚本 + 2 个声明/配置
   * 一起报成"未使用文件"（实测 34 个）。声明为 entry 后这层误报即消失，
   * 剩下的才是真正要处理的死代码。
   */
  entry: [
    'server/verify-*.mjs',
    'server/*-verify.mjs',
    'server/ai-agent/verify-*.mjs',
    'server/ai-agent/eval/*.mjs',
    'src/tanstack-router.d.ts',
    'vitest.chrome.config.ts',
    /*
     * 测试文件也必须声明为 entry —— 这是个踩过的坑（2026-10-14）：
     * knip 默认不分析测试文件，于是它们 import 的符号被误判成"未使用导出"。
     * 实测一次批量去掉 export 后，`sellersprite.node-test.mjs` 直接
     * `SyntaxError: does not provide an export named '...'`，`test:server`
     * 由 662/662 变成 642/643。声明测试文件后，knip 的"未使用导出"才是可信的。
     */
    '**/*.node-test.mjs',
    '**/*.test.ts',
    '**/*.test.tsx',
  ],
}

export default config