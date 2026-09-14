import '@tanstack/react-router'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /**
     * 页面标题：由全局 `Header` 渲染成该页唯一的 `h1`。
     *
     * 放在路由上而不是各页面自己写，是为了让「顶部只有一处标题」成为结构约束：
     * 页面组件里不再出现标题横幅，也就不会再出现同一名字写两遍（历史上竞品分析
     * 的页面名同时出现在 Header 和内容区 h1 里）。
     *
     * 带模块内二级导航的模块（AI 助手、AI 治理）只在**模块级路由**上声明模块名，
     * 子页由导航高亮表达位置，避免标题与导航项重复。
     */
    title?: string
  }
}
