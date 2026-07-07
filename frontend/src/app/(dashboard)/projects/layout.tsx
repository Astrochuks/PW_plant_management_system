'use client'

import { ProtectedRoute } from '@/components/protected-route'

/**
 * Gates the entire projects module: admin + management (MD/GPM) only.
 * The plant officer is management-tier for plants but has no projects
 * access. Inner pages add their own stricter admin gates where needed.
 */
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requiredRole="projects">{children}</ProtectedRoute>
}
