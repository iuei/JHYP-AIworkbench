import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { navigationLoadErrorMessage } from './navigation-errors'

describe('navigationLoadErrorMessage', () => {
  it('distinguishes an unavailable API from an expired login', () => {
    expect(navigationLoadErrorMessage(new AxiosError('Network Error'))).toBe(
      '无法连接快捷导航服务，请确认服务已启动后重试。'
    )
    expect(
      navigationLoadErrorMessage(
        new AxiosError('Unauthorized', '401', undefined, undefined, {
          status: 401,
          statusText: 'Unauthorized',
          headers: new AxiosHeaders(),
          config: { headers: new AxiosHeaders() },
          data: {},
        })
      )
    ).toBe('登录状态已失效，请重新登录。')
  })
})
