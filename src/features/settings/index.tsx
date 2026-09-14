import { Outlet } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'

export function Settings() {
  return (
    <Main fixed>
      <div className='flex flex-1 overflow-y-auto'>
        <Outlet />
      </div>
    </Main>
  )
}
