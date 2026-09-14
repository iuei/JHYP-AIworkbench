import { useSyncExternalStore } from 'react'
import authWorkbenchDark from '@/assets/auth-workbench-dark.png'
import authWorkbenchLight from '@/assets/auth-workbench-light.png'
import { Logo } from '@/assets/logo'
import { useTheme } from '@/context/theme-provider'

const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)'

function subscribeToDesktopChange(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY)
  mediaQuery.addEventListener('change', onStoreChange)

  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

function getIsDesktop() {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches
}

function useIsDesktop() {
  return useSyncExternalStore(subscribeToDesktopChange, getIsDesktop, () => false)
}

export function SignInBrandPanel() {
  const { resolvedTheme } = useTheme()
  const isDesktop = useIsDesktop()
  const backgroundSrc =
    resolvedTheme === 'dark' ? authWorkbenchDark : authWorkbenchLight

  return (
    <div className='relative min-h-svh overflow-hidden bg-muted/20'>
      {isDesktop && (
        <img
          src={backgroundSrc}
          alt=''
          aria-hidden='true'
          className='absolute inset-0 size-full object-cover object-center'
        />
      )}
      <div className='relative z-10 flex min-h-svh flex-col px-12 py-10 xl:px-20 xl:py-14'>
        <div className='flex items-center gap-2'>
          <Logo className='size-7' />
          <span className='text-lg font-semibold tracking-tight'>
            JHYP 智能工作台
          </span>
        </div>
        <div className='flex flex-1 flex-col justify-center pb-48 xl:pb-56'>
          <div className='max-w-xl space-y-4'>
            <h2 className='text-4xl font-bold tracking-tight xl:text-5xl'>
              JHYP 智能工作台
            </h2>
            <p className='text-lg text-muted-foreground xl:text-xl'>
              让跨境运营工作更高效、更清晰
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
