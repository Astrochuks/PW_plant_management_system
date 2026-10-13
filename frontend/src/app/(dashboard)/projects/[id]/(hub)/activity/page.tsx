'use client'

/**
 * Activity — who did what on this project, straight from the audit log.
 * A site engineer sees only their own actions (PRD v2 §11 D2).
 */

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useProjectActivity, useProjectId } from '@/hooks/use-projects'

const ACTION_LABEL: Record<string, string> = {
  create: 'Created project',
  update: 'Edited project',
  delete: 'Deleted',
  contract_sum_added: 'Contract sum recorded',
  status_changed: 'Status changed',
  document_uploaded: 'Document uploaded',
  confirm_upload: 'Weekly report accepted',
  upload: 'Weekly report uploaded',
  import: 'Imported',
}

export default function ProjectActivityPage() {
  const id = useProjectId()
  const { data, isLoading } = useProjectActivity(id, 200)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground">Every recorded action on this project, newest first.</p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Nothing recorded yet.</CardContent></Card>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{ACTION_LABEL[a.action] ?? a.action}</Badge>
                <span className="text-sm">{a.description || a.table_name}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(a.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
                {a.user_email ? ` · ${a.user_email}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
