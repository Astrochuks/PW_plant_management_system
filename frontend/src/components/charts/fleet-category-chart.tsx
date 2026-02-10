'use client';

/**
 * Fleet Category Donut Chart
 */

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { useTheme } from 'next-themes';

interface FleetCategoryChartProps {
  data: Array<{
    fleet_type_id: string;
    fleet_type_name: string;
    total_count: number;
    verified_count: number;
    active_count: number;
  }>;
}

export function FleetCategoryChart({ data }: FleetCategoryChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const { theme, resolvedTheme } = useTheme();
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

    // Prepare data for donut chart
    const chartData = data.map((item) => ({
      name: item.fleet_type_name || 'Uncategorized',
      value: item.total_count,
    }));

    // Brand colors palette
    const colors = [
      '#ffbf36', // Primary gold
      '#3b82f6', // Blue
      '#22c55e', // Green
      '#f59e0b', // Amber
      '#8b5cf6', // Purple
      '#ec4899', // Pink
      '#14b8a6', // Teal
      '#f97316', // Orange
    ];

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
        backgroundColor: isDark ? '#1a1d1e' : '#ffffff',
        borderColor: isDark ? '#2d3133' : '#e4e4e7',
        textStyle: {
          color: isDark ? '#fafafa' : '#101415',
        },
      },
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'center',
        textStyle: {
          color: isDark ? '#a1a1aa' : '#71717a',
        },
      },
      series: [
        {
          name: 'Fleet Category',
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: isDark ? '#101415' : '#ffffff',
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
            },
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
            },
          },
          data: chartData,
          color: colors,
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
