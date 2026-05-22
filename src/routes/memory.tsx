import { createFileRoute } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'

export const Route = createFileRoute('/memory')({
  ssr: false,
  component: MemoryRoute,
})

function MemoryRoute() {
  const navigate = useNavigate()
  usePageTitle('Memory')

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-primary-200 bg-primary-50/80 p-8 text-center dark:border-neutral-800 dark:bg-neutral-900/60">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={32}
          strokeWidth={1.5}
          className="mx-auto text-primary-400 dark:text-neutral-500"
        />
        <h2 className="mt-4 text-lg font-bold text-primary-900 dark:text-neutral-100">
          Memory is in Profiles
        </h2>
        <p className="mt-2 text-sm text-primary-600 dark:text-neutral-400">
          Agent memory, SOUL, and skills are now viewable from the{' '}
          <button
            type="button"
            onClick={() => void navigate({ to: '/profiles' })}
            className="font-semibold text-accent-500 hover:underline"
          >
            Profiles tab
          </button>{' '}
          — open any agent's Details drawer to see their full configuration.
        </p>
      </div>
    </div>
  )
}
