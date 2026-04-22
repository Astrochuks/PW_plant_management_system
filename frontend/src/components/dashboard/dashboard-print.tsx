'use client'

import { useCallback } from 'react'
import * as echarts from 'echarts'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DashboardPrintButton() {
  const handlePrint = useCallback(() => {
    // Convert all ECharts canvases to static images for print
    const chartEls = document.querySelectorAll('[data-print-chart]')
    const images: HTMLImageElement[] = []

    chartEls.forEach((el) => {
      const chart = echarts.getInstanceByDom(el as HTMLElement)
      if (chart) {
        const img = document.createElement('img')
        img.src = chart.getDataURL({ type: 'png', pixelRatio: 2 })
        img.className = 'print-chart-image'
        img.style.cssText = 'display:none;width:100%;height:auto;'
        el.parentElement?.appendChild(img)
        images.push(img)
      }
    })

    // Wait a frame so images render, then print
    requestAnimationFrame(() => {
      window.print()

      // Cleanup static images after print dialog closes
      setTimeout(() => {
        images.forEach((img) => img.remove())
      }, 500)
    })
  }, [])

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handlePrint}
      className="h-9 gap-1.5 print:hidden"
    >
      <Printer className="h-3.5 w-3.5" />
      Print Report
    </Button>
  )
}
