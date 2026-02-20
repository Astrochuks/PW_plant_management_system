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

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

function downloadCSV(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
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
  const [plantsStatus, setPlantsStatus] = useState<string>('')
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
        ...(plantsStatus ? { status: plantsStatus } : {}),
        ...(plantsLocation ? { location_id: plantsLocation } : {}),
      })

      if (plantsFormat === 'csv' && typeof result.data === 'string') {
        downloadCSV(result.data, `plants_export_${new Date().toISOString().slice(0, 10)}.csv`)
      } else {
        downloadJSON(result.data, `plants_export_${new Date().toISOString().slice(0, 10)}.json`)
      }
      setPlantsResult(`Exported ${result.count} plant records`)
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

      if (maintFormat === 'csv' && typeof result.data === 'string') {
        downloadCSV(
          result.data,
          `maintenance_export_${maintYear}_${new Date().toISOString().slice(0, 10)}.csv`
        )
      } else {
        downloadJSON(
          result.data,
          `maintenance_export_${maintYear}_${new Date().toISOString().slice(0, 10)}.json`
        )
      }
      setMaintResult(`Exported ${result.count} maintenance records`)
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

              <Select value={plantsStatus} onValueChange={setPlantsStatus}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="working">Working</SelectItem>
                  <SelectItem value="standby">Standby</SelectItem>
                  <SelectItem value="breakdown">Breakdown</SelectItem>
                  <SelectItem value="under_repair">Under Repair</SelectItem>
                  <SelectItem value="missing">Missing</SelectItem>
                  <SelectItem value="scrap">Scrap</SelectItem>
                </SelectContent>
              </Select>

              <Select value={plantsLocation} onValueChange={setPlantsLocation}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
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
