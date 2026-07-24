'use client'

/**
 * Plant workbench tabs — management's way into the plant module.
 *
 * Admins and plant officers navigate the module from the sidebar; for
 * management the whole module is one sidebar entry, "Plant", and these
 * tabs sit above every page in it. Deep pages (a plant's detail, a PO,
 * a report) keep the bar with their parent tab lit, so the way back is
 * always one click.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/providers/auth-provider'
import { isManagementRole } from '@/lib/roles'

const TABS = [
  { href: '/plant', label: 'Dashboard', match: (p: string) => p === '/plant' },
  { href: '/plants', label: 'Fleet Register', match: (p: string) => p.startsWith('/plants') },
  { href: '/spare-parts', label: 'Spare Parts', match: (p: string) => p.startsWith('/spare-parts') },
  { href: '/transfers', label: 'Transfers', match: (p: string) => p.startsWith('/transfers') },
  { href: '/reports', label: 'Reports', match: (p: string) => p.startsWith('/reports') },
]

/** True when this path belongs to the plant module. */
export const isPlantPath = (pathname: string): boolean =>
  TABS.some((t) => t.match(pathname))

export function PlantTabs() {
  const pathname = usePathname()
  const { user } = useAuth()

  if (!isManagementRole(user?.role) || !isPlantPath(pathname)) return null

  return (
    <div className="mb-5 flex items-end gap-0.5 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((t) => {
        const active = t.match(pathname)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px inline-flex shrink-0 items-center whitespace-nowrap rounded-t-lg border px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${
              active
                ? 'border-primary border-b-transparent bg-primary font-semibold text-primary-foreground shadow-[0_-4px_10px_-4px_rgba(0,0,0,0.25)]'
                : 'border-border/40 border-b-border bg-muted/50 text-muted-foreground shadow-sm hover:-translate-y-0.5 hover:bg-muted hover:text-foreground hover:shadow-md'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
