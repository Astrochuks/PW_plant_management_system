'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Calendar } from 'lucide-react'
import Image from 'next/image'
import { useAuth } from '@/providers/auth-provider'
import { SiteSidebar } from '@/components/site/site-sidebar'

function getISOWeek(): number {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const pastDays = (now.getTime() - startOfYear.getTime()) / 86400000
  return Math.ceil((pastDays + startOfYear.getDay() + 1) / 7)
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
      return
    }
    if (!isLoading && isAuthenticated && user && user.role !== 'site_engineer') {
      router.replace('/')
    }
  }, [isAuthenticated, isLoading, user, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 relative">
            <Image src="/images/logo.png" alt="P.W. Nigeria" fill className="object-contain" />
          </div>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteSidebar />
      <div className="pl-[220px] min-h-screen flex flex-col">
        {/* Top header bar — matches admin/management header style */}
        <header className="h-12 border-b bg-background/95 backdrop-blur flex items-center px-6 shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {new Date().toLocaleDateString('en-NG', {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Week {getISOWeek()}</span>
          </div>
        </header>

        <main className="flex-1">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
