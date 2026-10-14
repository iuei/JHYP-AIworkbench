import { describe, expect, it } from 'vitest'
import { splitEndpointSecret } from './mcp-endpoint'

/**
 * 端点里粘进 `?secret-key=xxx` 是真实发生过的填法（官方文档就给了这种 URL 直连写法）。
 * 界面必须在保存前把它搬到密钥框：否则密钥明文留在端点里，而状态徽章显示"密钥来源：未配置"。
 */
describe('splitEndpointSecret', () => {
  it('拆出密钥并把端点还原成标准值', () => {
    expect(splitEndpointSecret('https://mcp.sellersprite.com/mcp?secret-key=abc123')).toEqual({
      endpoint: 'https://mcp.sellersprite.com/mcp',
      secret: 'abc123',
    })
  })

  it('端点没有密钥时返回 null（照常保存，不改写用户输入）', () => {
    expect(splitEndpointSecret('https://mcp.sellersprite.com/mcp')).toBeNull()
  })

  it('保留其它查询参数，只摘掉 secret-key', () => {
    expect(splitEndpointSecret('https://mcp.sellersprite.com/mcp?secret-key=k&v=2')?.endpoint).toBe(
      'https://mcp.sellersprite.com/mcp?v=2'
    )
  })

  it('非法输入不抛错（保存前不该因为一串乱码卡住界面）', () => {
    expect(splitEndpointSecret('not a url')).toBeNull()
    expect(splitEndpointSecret('')).toBeNull()
  })
})
