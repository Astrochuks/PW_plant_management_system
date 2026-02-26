'use client'

import { useState, useRef } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useImportAwardLetters, type ImportResult } from '@/hooks/use-projects'
import { toast } from 'sonner'

export function ImportAwardLettersDialog() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importMutation = useImportAwardLetters()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
      setResult(null)
    }
  }

  const handleImport = async () => {
    if (!file) return

    try {
      const data = await importMutation.mutateAsync(file)
      setResult(data)
      toast.success(`Imported ${data.created} projects from ${data.sheets_processed} sheets`)
    } catch {
      toast.error('Import failed. Please check the file format.')
    }
  }

  const handleClose = () => {
    setOpen(false)
    setFile(null)
    setResult(null)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Import Award Letters
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Award Letters</DialogTitle>
          <DialogDescription>
            Upload the Award Letters & Completion Certificates Excel file.
            Each sheet (client/state) will be parsed into project records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* File picker */}
          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                <span className="font-medium">{file.name}</span>
                <span className="text-muted-foreground">
                  ({(file.size / 1024).toFixed(0)} KB)
                </span>
              </div>
            ) : (
              <div className="text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click to select an Excel file</p>
                <p className="text-xs mt-1">.xlsx or .xls</p>
              </div>
            )}
          </div>

          {/* Import button */}
          {file && !result && (
            <Button
              onClick={handleImport}
              disabled={importMutation.isPending}
              className="w-full"
            >
              {importMutation.isPending ? 'Importing...' : 'Import Projects'}
            </Button>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Import Complete</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Sheets processed:</div>
                <div className="font-medium">{result.sheets_processed}</div>
                <div>Projects parsed:</div>
                <div className="font-medium">{result.total_parsed}</div>
                <div>Projects created:</div>
                <div className="font-medium text-emerald-600">{result.created}</div>
                {result.errors.length > 0 && (
                  <>
                    <div>Errors:</div>
                    <div className="font-medium text-red-600">{result.errors.length}</div>
                  </>
                )}
              </div>

              {result.errors.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center gap-1 text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Some rows had errors:</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-1">
                    {result.errors.slice(0, 10).map((err, i) => (
                      <div key={i}>
                        {err.sheet}: {err.project_name || 'Unknown'} — {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button onClick={handleClose} className="w-full" variant="outline">
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
