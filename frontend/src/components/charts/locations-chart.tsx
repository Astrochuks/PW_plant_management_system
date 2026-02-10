'use client';

/**
 * Locations Horizontal Bar Chart
 */

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { useTheme } from 'next-themes';

interface LocationsChartProps {
  data: Array<{
    location_id: string;
    location_name: string;
    total_plants: number;
    verified_plants: number;
    active_plants: number;
    verification_rate: number;
  }>;
}

export function LocationsChart({ data }: LocationsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Wait for client-side hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!chartRef.current || !mounted) return;

    // Initialize chart
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    const isDark = resolvedTheme === 'dark';

    // Take top 8 locations
    const topLocations = data.slice(0, 8);
    const locations = topLocations.map((item) => item.location_name);
    const plantCounts = topLocations.map((item) => item.total_plants);
    const verifiedCounts = topLocations.map((item) => item.verified_plants);

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        backgroundColor: isDark ? '#1a1d1e' : '#ffffff',
        borderColor: isDark ? '#2d3133' : '#e4e4e7',
        textStyle: {
          color: isDark ? '#fafafa' : '#101415',
        },
      },
      legend: {
        data: ['Total Plants', 'Verified'],
        bottom: 0,
        textStyle: {
          color: isDark ? '#a1a1aa' : '#71717a',
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLine: {
          lineStyle: {
            color: isDark ? '#2d3133' : '#e4e4e7',
          },
        },
        axisLabel: {
          color: isDark ? '#a1a1aa' : '#71717a',
        },
        splitLine: {
          lineStyle: {
            color: isDark ? '#2d3133' : '#e4e4e7',
          },
        },
      },
      yAxis: {
        type: 'category',
        data: locations,
        axisLine: {
          lineStyle: {
            color: isDark ? '#2d3133' : '#e4e4e7',
          },
        },
        axisLabel: {
          color: isDark ? '#a1a1aa' : '#71717a',
          width: 100,
          overflow: 'truncate',
        },
      },
      series: [
        {
          name: 'Total Plants',
          type: 'bar',
          data: plantCounts,
          itemStyle: {
            color: '#ffbf36',
            borderRadius: [0, 4, 4, 0],
          },
          barWidth: '40%',
        },
        {
          name: 'Verified',
          type: 'bar',
          data: verifiedCounts,
          itemStyle: {
            color: '#22c55e',
            borderRadius: [0, 4, 4, 0],
          },
          barWidth: '40%',
        },
      ],
    };

    chartInstance.current.setOption(option);

    // Handle resize
    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [data, resolvedTheme, mounted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
    };
  }, []);

  if (data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  return <div ref={chartRef} className="h-[300px] w-full" />;
}
