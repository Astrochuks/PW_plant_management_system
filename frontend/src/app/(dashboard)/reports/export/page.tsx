'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocationsWithStats } from '@/hooks/use-locations'
import { exportPlants, exportMaintenance } from '@/lib/api/reports'
import { ALL, only } from '@/lib/filters'

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

/**
 * Save an already-downloaded file.
 *
 * The endpoints now stream the finished CSV/JSON, so there is nothing
 * left to format here — the previous two helpers existed only to rebuild
 * a file out of a JSON envelope that had just been parsed.
 */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function ExportPage() {
  const { data: locations = [] } = useLocationsWithStats()

  // Plants export state
  const [plantsFormat, setPlantsFormat] = useState<'csv' | 'json'>('csv')
  const [plantsCondition, setPlantsCondition] = useState<string>('')
  const [plantsLocation, setPlantsLocation] = useState<string>('')
  const [plantsLoading, setPlantsLoading] = useState(false)
  const [plantsResult, setPlantsResult] = useState<string | null>(null)

  // Maintenance export state
  const [maintFormat, setMaintFormat] = useState<'csv' | 'json'>('csv')
  const [maintYear, setMaintYear] = useState<number>(currentYear)
  const [maintLoading, setMaintLoading] = useState(false)
  const [maintResult, setMaintResult] = useState<string | null>(null)

  const handleExportPlants = async () => {
    setPlantsLoading(true)
    setPlantsResult(null)
    try {
      const result = await exportPlants({
        format: plantsFormat,
        ...(only(plantsCondition) ? { condition: plantsCondition } : {}),
        ...(only(plantsLocation) ? { location_id: plantsLocation } : {}),
      })

      saveFile(result.blob, result.filename)
      setPlantsResult(`Exported ${result.count.toLocaleString()} plant records`)
    } catch {
      setPlantsResult('Export failed. Please try again.')
    } finally {
      setPlantsLoading(false)
    }
  }

  const handleExportMaintenance = async () => {
    setMaintLoading(true)
    setMaintResult(null)
    try {
      const result = await exportMaintenance({
        format: maintFormat,
        year: maintYear,
      })

      // Keep the year in the name — the server does not know it was filtered.
      saveFile(
        result.blob,
        result.filename.replace('maintenance_export_', `maintenance_export_${maintYear}_`)
      )
      setMaintResult(`Exported ${result.count.toLocaleString()} maintenance records`)
    } catch {
      setMaintResult('Export failed. Please try again.')
    } finally {
      setMaintLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/reports"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Export Data</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Download plant and maintenance data as CSV or JSON
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Export Plants */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export Plants
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Select
                value={plantsFormat}
                onValueChange={(v) => setPlantsFormat(v as 'csv' | 'json')}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      CSV
                    </div>
                  </SelectItem>
                  <SelectItem value="json">
                    <div className="flex items-center gap-2">
                      <FileJson className="h-3.5 w-3.5" />
                      JSON
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={plantsCondition || ALL} onValueChange={(v) => setPlantsCondition(v === ALL ? '' : v)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All conditions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All conditions</SelectItem>
                  <SelectItem value="working">Working</SelectItem>
                  <SelectItem value="standby">Standby</SelectItem>
                  <SelectItem value="breakdown">Breakdown</SelectItem>
                  <SelectItem value="missing">Missing</SelectItem>
                  <SelectItem value="scrap">Scrap</SelectItem>
                  <SelectItem value="off_hire">Off hire</SelectItem>
                </SelectContent>
              </Select>

              <Select value={plantsLocation || ALL} onValueChange={(v) => setPlantsLocation(v === ALL ? '' : v)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All locations</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.location_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleExportPlants}
              disabled={plantsLoading}
              className="w-full"
            >
              {plantsLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export Plants ({plantsFormat.toUpperCase()})
            </Button>

            {plantsResult && (
              <p className="text-sm text-muted-foreground text-center">
                {plantsResult}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Export Maintenance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export Maintenance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Select
                value={maintFormat}
                onValueChange={(v) => setMaintFormat(v as 'csv' | 'json')}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      CSV
                    </div>
                  </SelectItem>
                  <SelectItem value="json">
                    <div className="flex items-center gap-2">
                      <FileJson className="h-3.5 w-3.5" />
                      JSON
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={String(maintYear)}
                onValueChange={(v) => setMaintYear(Number(v))}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleExportMaintenance}
              disabled={maintLoading}
              className="w-full"
            >
              {maintLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export Maintenance ({maintFormat.toUpperCase()})
            </Button>

            {maintResult && (
              <p className="text-sm text-muted-foreground text-center">
                {maintResult}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
