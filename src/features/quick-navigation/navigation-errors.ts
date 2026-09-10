import { isAxiosError } from 'axios'

export function navigationLoadErrorMessage(error: unknown) {
  if (!isAxiosError(error)) return '快捷导航加载失败，请稍后重试。'
  if (!error.response) {
    return '无法连接快捷导航服务，请确认服务已启动后重试。'
  }
  if (error.response.status === 401) {
    return '登录状态已失效，请重新登录。'
  }
  if (error.response.status === 403) {
    return '你没有访问快捷导航的权限。'
  }
  return '快捷导航服务暂时不可用，请联系管理员检查服务状态。'
}

