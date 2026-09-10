import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate, Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SidebarNavItem = {
  href: string
  title: string
  icon: ReactNode
}

type SidebarNavProps = React.HTMLAttributes<HTMLElement> & {
  groups: {
    title: string
    icon: ReactNode
    items: SidebarNavItem[]
  }[]
}

export function SidebarNav({ className, groups, ...props }: SidebarNavProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.map((group) => [
        group.title,
        group.items.some((item) => item.href === pathname),
      ])
    )
  )

  const handleSelect = (href: string) => {
    navigate({ to: href })
  }

  return (
    <>
      <div className='p-1 lg:hidden'>
        <Select value={pathname} onValueChange={handleSelect}>
          <SelectTrigger className='h-12 w-full sm:w-64'>
            <SelectValue placeholder='设置项' />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.title}>
                <SelectLabel>{group.title}</SelectLabel>
                {group.items.map((item) => (
                  <SelectItem key={item.href} value={item.href}>
                    <div className='flex gap-x-4 px-2 py-1'>
                      <span className='scale-125'>{item.icon}</span>
                      <span className='text-md'>{item.title}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea
        orientation='horizontal'
        type='always'
        className='hidden w-full min-w-40 bg-background px-1 py-2 lg:block'
      >
        <nav
          className={cn('flex flex-col space-y-1 py-1', className)}
          {...props}
        >
          {groups.map((group) => (
            <Collapsible
              key={group.title}
              open={openGroups[group.title]}
              onOpenChange={(open) =>
                setOpenGroups((current) => ({
                  ...current,
                  [group.title]: open,
                }))
              }
              className='group/collapsible space-y-1'
            >
              <CollapsibleTrigger className='flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring'>
                <span className='flex items-center gap-2'>
                  {group.icon}
                  {group.title}
                </span>
                <ChevronRight className='size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 rtl:rotate-180' />
              </CollapsibleTrigger>
              <CollapsibleContent className='ms-4 space-y-1 border-s ps-2'>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() =>
                      setOpenGroups((current) => ({
                        ...current,
                        [group.title]: true,
                      }))
                    }
                    className={cn(
                      buttonVariants({ variant: 'ghost' }),
                      pathname === item.href
                        ? 'bg-muted font-medium text-foreground hover:bg-accent'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      'w-full justify-start'
                    )}
                  >
                    <span className='me-2'>{item.icon}</span>
                    {item.title}
                  </Link>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </nav>
      </ScrollArea>
    </>
  )
}
