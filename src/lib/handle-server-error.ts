import { AxiosError } from 'axios'
import { toast } from 'sonner'

export function handleServerError(error: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(error)
  }

  let errMsg = 'Something went wrong!'

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = 'No content.'
  }

  if (error instanceof AxiosError) {
    // 本项目的服务端统一返回 `{ message: '中文原因' }`（见 server/index.mjs 的统一错误出口，
    // 例如输入校验的 400、越权与记录不存在的 404）。原来的实现只读模板继承来的 `data.title`，
    // 于是用户看到的是「Something went wrong!」这种英文通用提示，服务端写好的原因被丢掉。
    // 两个字段都读：`message` 优先，`title` 保留兼容。
    const data = error.response?.data as
      | { message?: unknown; title?: unknown }
      | undefined
    const message =
      typeof data?.message === 'string' && data.message.length > 0
        ? data.message
        : null
    const title =
      typeof data?.title === 'string' && data.title.length > 0
        ? data.title
        : null
    if (message) errMsg = message
    else if (title) errMsg = title
  }

  toast.error(errMsg)
}
