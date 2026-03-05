'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ClipboardList,
  History,
  ArrowLeftRight,
  LogOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/providers/auth-provider'
import { useIncomingTransferCount } from '@/hooks/use-site-report'

const NAV = [
  { title: 'My Site', href: '/site/dashboard', icon: LayoutDashboard },
  { title: 'Weekly Report', href: '/site/report', icon: ClipboardList },
  { title: 'Submissions', href: '/site/submissions', icon: History },
  { title: 'Transfers', href: '/site/transfers', icon: ArrowLeftRight },
]

export function SiteSidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { data: incomingCount = 0 } = useIncomingTransferCount()

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-[220px] bg-card border-r flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b">
        <div className="w-8 h-8 relative shrink-0">
          <Image src="/images/logo.png" alt="P.W. Nigeria" fill className="object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">Site Engineer</p>
          <p className="text-xs text-muted-foreground truncate">{user?.full_name || user?.email}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map(({ title, href, icon: Icon }) => {
          const isActive = pathname === href || (href !== '/site/dashboard' && pathname.startsWith(href))
          const badge = title === 'Transfers' && incomingCount > 0 ? incomingCount : 0
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{title}</span>
              {badge > 0 && (
                <Badge variant="destructive" className="h-5 min-w-5 px-1 text-xs">
                  {badge}
                </Badge>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={logout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </aside>
  )
}
