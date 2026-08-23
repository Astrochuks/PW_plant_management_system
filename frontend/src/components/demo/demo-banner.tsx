'use client'

import { Info } from 'lucide-react'

import { IS_DEMO } from '@/lib/demo'

/**
 * Standing notice that this deployment is a demo.
 *
 * Deliberately not dismissible. A visitor who scrolls past it and then
 * screenshots a figure must not be able to present it as a real PW
 * number — every value in this build is invented.
 */
export function DemoBanner() {
  if (!IS_DEMO) return null

  return (
    <div
      role="note"
      className="sticky top-0 z-50 border-b border-amber-300/60 bg-amber-50 px-4 py-2
                 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/60
                 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm">
        <Info className="h-4 w-4 shrink-0" aria-hidden />
        <p className="leading-snug">
          <span className="font-semibold">Demo.</span>{' '}
          Every plant, supplier, price and project below is invented — no real
          P.W. Nigeria data appears here. Editing is disabled.
        </p>
      </div>
    </div>
  )
}
