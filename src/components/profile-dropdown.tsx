import { Link } from '@tanstack/react-router'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

export function ProfileDropdown() {
  return (
    <Button
      variant='ghost'
      className='relative h-8 w-8 rounded-full'
      asChild
    >
      <Link to='/settings' aria-label='打开用户信息'>
            <Avatar className='h-8 w-8'>
          <AvatarImage src='/avatars/01.png' alt='内部用户' />
              <AvatarFallback>SN</AvatarFallback>
            </Avatar>
      </Link>
    </Button>
  )
}
