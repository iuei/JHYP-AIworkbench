import { cn } from '@/lib/utils'

type NavigationTagProps = {
  name: string
  className?: string
}

export function NavigationTag({ name, className }: NavigationTagProps) {
  return (
    <span
      className={cn(
        'inline-flex rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground',
        className
      )}
    >
      {name}
    </span>
  )
}

