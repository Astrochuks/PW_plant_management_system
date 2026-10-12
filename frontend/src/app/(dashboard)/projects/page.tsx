import { redirect } from 'next/navigation'

/** The old Project Registry page was deleted on 2026-10-12. /projects forwards to the ongoing register. */
export default function ProjectsIndex() {
  redirect('/projects/ongoing')
}
