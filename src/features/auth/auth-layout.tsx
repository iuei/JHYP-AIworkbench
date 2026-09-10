import { Logo } from '@/assets/logo'

type AuthLayoutVariant = 'centered' | 'split'

type AuthLayoutProps = {
  children: React.ReactNode
  variant?: AuthLayoutVariant
  aside?: React.ReactNode
}

function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Logo className='size-7' />
      <span className='text-lg font-semibold tracking-tight'>
        JHYP 智能工作台
      </span>
    </div>
  )
}

export function AuthLayout({
  children,
  variant = 'centered',
  aside,
}: AuthLayoutProps) {
  if (variant === 'split') {
    return (
      <div className='grid min-h-svh bg-background lg:grid-cols-[minmax(0,56fr)_minmax(26rem,44fr)]'>
        <aside className='hidden min-h-svh border-e lg:block'>{aside}</aside>
        <main className='flex min-h-svh items-center px-6 py-10 sm:px-10 lg:px-6 xl:px-14 2xl:px-20'>
          <div className='mx-auto w-full max-w-[27rem]'>
            <BrandLockup className='mb-10 lg:hidden' />
            {children}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center'>
          <Logo className='me-2' />
          <h1 className='text-xl font-medium'>智能工作台</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
