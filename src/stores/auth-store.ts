import { create } from 'zustand'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

const ACCESS_TOKEN = 'thisisjustarandomstring'
const AUTH_USER = 'auth_user'

export interface AuthUser {
  accountNo: string
  email: string
  role: string[]
  exp: number
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
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
      setAccessToken: (accessToken) =>
        set((state) => {
          setCookie(ACCESS_TOKEN, JSON.stringify(accessToken))
          return { ...state, auth: { ...state.auth, accessToken } }
        }),
      resetAccessToken: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN)
          removeCookie(AUTH_USER)
          return {
            ...state,
            auth: { ...state.auth, user: null, accessToken: '' },
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
            auth: { ...state.auth, user: null, accessToken: '' },
          }
        }),
    },
  }
})
