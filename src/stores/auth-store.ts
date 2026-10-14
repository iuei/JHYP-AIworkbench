import { create } from 'zustand'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

const ACCESS_TOKEN = 'thisisjustarandomstring'
const AUTH_USER = 'auth_user'

export interface AuthUser {
  accountNo: string
  email: string
  /**
   * 姓名。登录响应里就有，但老会话的 cookie 里可能没有（该字段是后补的），
   * 因此标为可选：消费方（如侧边栏底部）必须能容忍它缺失。
   */
  name?: string
  role: string[]
  exp: number
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    /**
     * 本次页面会话内**成功登录**的时间戳；0 表示这次没有登录过（含刷新页面后恢复会话）。
     *
     * 只放在内存里、不写 cookie：公告的「每次登录都弹」需要区分"登录"和"刷新 / 站内跳转"，
     * 而这个区别只在这一层能表达 —— cookie 里的 token 在刷新后依然有效，看 token 是分不出来的。
     */
    loginAt: number
    setAccessToken: (accessToken: string) => void
    resetAccessToken: () => void
    isSessionExpired: () => boolean
    isAuthenticated: () => boolean
    reset: () => void
  }
}

function readJsonCookie<T>(name: string): T | null {
  const cookieState = getCookie(name)
  if (!cookieState) return null

  try {
    return JSON.parse(cookieState) as T
  } catch {
    removeCookie(name)
    return null
  }
}

export const useAuthStore = create<AuthState>()((set, get) => {
  const initToken = readJsonCookie<string>(ACCESS_TOKEN) ?? ''
  const initUser = readJsonCookie<AuthUser>(AUTH_USER)

  return {
    auth: {
      user: initUser,
      setUser: (user) =>
        set((state) => {
          if (user) {
            setCookie(AUTH_USER, JSON.stringify(user))
          } else {
            removeCookie(AUTH_USER)
          }

          return { ...state, auth: { ...state.auth, user } }
        }),
      accessToken: initToken,
      loginAt: 0,
      setAccessToken: (accessToken) =>
        set((state) => {
          setCookie(ACCESS_TOKEN, JSON.stringify(accessToken))
          return {
            ...state,
            auth: { ...state.auth, accessToken, loginAt: Date.now() },
          }
        }),
      resetAccessToken: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN)
          removeCookie(AUTH_USER)
          return {
            ...state,
            auth: { ...state.auth, user: null, accessToken: '', loginAt: 0 },
          }
        }),
      isSessionExpired: () => {
        const user = get().auth.user
        return user ? user.exp <= Date.now() : false
      },
      isAuthenticated: () => {
        const { accessToken, isSessionExpired } = get().auth
        return Boolean(accessToken) && !isSessionExpired()
      },
      reset: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN)
          removeCookie(AUTH_USER)
          return {
            ...state,
            auth: { ...state.auth, user: null, accessToken: '', loginAt: 0 },
          }
        }),
    },
  }
})
