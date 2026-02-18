'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertCircle, Home } from 'lucide-react'

export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <AlertCircle className="h-16 w-16 text-destructive" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this page. This area is restricted to administrators.
          </p>
        </div>

        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
          <p className="text-sm text-destructive/80">
            If you believe this is a mistake, please contact your administrator.
          </p>
        </div>

        <div className="flex gap-3 justify-center">
          <Button asChild variant="outline">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              Go to Dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
