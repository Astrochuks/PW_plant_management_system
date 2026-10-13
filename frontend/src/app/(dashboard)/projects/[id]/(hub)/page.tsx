import { redirect } from 'next/navigation'

/**
 * /projects/<slug> opens the Bill of Quantities (decision 2026-10-14: the
 * bill is the focus). The former Overview lives on in overview-page.tsx
 * and returns to the tab bar when it is needed again.
 */
export default async function ProjectIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/projects/${id}/bills`)
}
