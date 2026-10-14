/**
 * 卖家精灵 MCP 端点的纯函数（与组件分开，避免影响 fast refresh —— 同 `format.ts` 的理由）。
 */

/**
 * 把 `?secret-key=xxx` 从端点里拆出来。
 *
 * 卖家精灵官方文档同时给了这种"URL 直连"写法（`https://mcp.sellersprite.com/mcp?secret-key=xxx`），
 * 管理员很容易把整条 URL 粘进「MCP 端点」框 —— 这样虽然也能连通，但密钥会**明文**留在端点里，
 * 而界面上却显示"密钥来源：未配置"。保存前自动搬到下方密钥框（服务端保存时也会做同一次搬运兜底）。
 */
export function splitEndpointSecret(
  input: string
): { endpoint: string; secret: string } | null {
  try {
    const url = new URL(input.trim())
    const secret = url.searchParams.get('secret-key')
    if (!secret) return null
    url.searchParams.delete('secret-key')
    const query = url.searchParams.toString()
    return {
      endpoint: `${url.origin}${url.pathname}${query ? `?${query}` : ''}`,
      secret: secret.trim(),
    }
  } catch {
    return null
  }
}
