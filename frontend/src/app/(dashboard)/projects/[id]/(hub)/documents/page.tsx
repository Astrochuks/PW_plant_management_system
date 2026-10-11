'use client'

/**
 * Documents — the evidence behind the register (award letter, variation
 * orders, certificates, BEMEs). Files live untouched in private storage and
 * are served through one-hour signed links; the route is scope-guarded.
 */

import { useParams } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, FileText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/providers/auth-provider'
import { useProjectDocumentUrl, useProjectDocuments, useUploadProjectDocument } from '@/hooks/use-projects'
import { getErrorMessage } from '@/lib/api/client'
import { fmtDate } from '@/lib/format'

const DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'award_letter', label: 'Award letter' },
  { value: 'contract', label: 'Contract / variation order' },
  { value: 'completion_cert', label: 'Completion certificate' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'payment_voucher', label: 'Payment voucher' },
  { value: 'other', label: 'Other' },
]
const fmtSize = (n: number | null) => (n == null ? '' : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

export default function ProjectDocumentsPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: docs, isLoading } = useProjectDocuments(id)
  const upload = useUploadProjectDocument(id)
  const link = useProjectDocumentUrl()
  const fileRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState('award_letter')
  const [title, setTitle] = useState('')

  const onUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return toast.error('Choose a file first')
    try {
      await upload.mutateAsync({ file, document_type: type, title: title.trim() || undefined })
      toast.success(`Uploaded ${file.name}`)
      setTitle(''); if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const open = async (documentId: string) => {
    try {
      const url = await link.mutateAsync({ projectId: id, documentId })
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="text-sm text-muted-foreground">The papers behind the register&apos;s facts. Links expire after an hour.</p>
      </div>

      {isAdmin && (
        <Card>
          <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title (optional)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Award letter ref ABC/123" />
            </div>
            <div>
              <Label>File</Label>
              <Input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
            </div>
            <Button onClick={onUpload} disabled={upload.isPending}>
              <Upload className="mr-2 h-4 w-4" /> Upload
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !docs?.length ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No documents yet.</CardContent></Card>
      ) : (
        <ul className="divide-y rounded-lg border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.title || d.file_name}</div>
                <div className="text-xs text-muted-foreground">
                  {d.file_name}{d.file_size ? ` · ${fmtSize(d.file_size)}` : ''} · uploaded {fmtDate(d.uploaded_at.slice(0, 10))}
                  {d.uploaded_by_name ? ` by ${d.uploaded_by_name}` : ''}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">{DOC_TYPES.find((t) => t.value === d.document_type)?.label ?? d.document_type}</Badge>
              <Button variant="ghost" size="sm" onClick={() => open(d.id)} disabled={link.isPending}>
                <Download className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
