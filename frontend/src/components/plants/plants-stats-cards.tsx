'use client';

/**
 * Plants Summary Strip + Condition Pills
 * Compact filter-responsive KPIs and clickable condition filters
 */

import { Truck, CheckCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlantFilteredStats } from '@/lib/api/plants';

// ---------------------------------------------------------------------------
// Condition config
// ---------------------------------------------------------------------------
const CONDITIONS = [
  { key: 'working',        label: 'Working',        dotColor: 'bg-emerald-500',  activeBg: 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700' },
  { key: 'standby',        label: 'Standby',        dotColor: 'bg-amber-500',    activeBg: 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700' },
  { key: 'under_repair',   label: 'Under Repair',   dotColor: 'bg-blue-500',     activeBg: 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700' },
  { key: 'breakdown',      label: 'Breakdown',      dotColor: 'bg-red-600',      activeBg: 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700' },
  { key: 'faulty',         label: 'Faulty',         dotColor: 'bg-orange-500',   activeBg: 'bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700' },
  { key: 'missing',        label: 'Missing',        dotColor: 'bg-red-400',      activeBg: 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700' },
  { key: 'scrap',          label: 'Scrap',          dotColor: 'bg-gray-400',     activeBg: 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600' },
  { key: 'off_hire',       label: 'Off Hire',       dotColor: 'bg-slate-500',    activeBg: 'bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-600' },
  { key: 'gpm_assessment', label: 'GPM Assessment', dotColor: 'bg-purple-500',   activeBg: 'bg-purple-50 dark:bg-purple-950 border-purple-300 dark:border-purple-700' },
  { key: 'unverified',     label: 'Unverified',     dotColor: 'bg-gray-300',     activeBg: 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600' },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface PlantsStatsCardsProps {
  stats: PlantFilteredStats | undefined;
  isLoading: boolean;
  activeConditions: string[];
  onConditionToggle: (condition: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PlantsStatsCards({
  stats,
  isLoading,
  activeConditions,
  onConditionToggle,
}: PlantsStatsCardsProps) {
  if (isLoading) return <StatsCardsSkeleton />;
  if (!stats) return null;

  const total = stats.total;
  const working = stats.by_condition['working'] ?? 0;
  const breakdown = stats.by_condition['breakdown'] ?? 0;
  const workingPct = total > 0 ? Math.round((working / total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Summary Strip: 3 compact KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <MiniKpi
          label="Total Plants"
          value={total.toLocaleString()}
          sub={`across ${Object.keys(stats.by_location).filter(k => k !== 'Unknown').length} sites`}
          icon={Truck}
          iconColor="text-blue-600 dark:text-blue-400"
        />
        <MiniKpi
          label="Working"
          value={working.toLocaleString()}
          sub={`${workingPct}% of fleet`}
          icon={CheckCircle}
          iconColor="text-emerald-600 dark:text-emerald-400"
        />
        <MiniKpi
          label="Breakdown"
          value={breakdown.toLocaleString()}
          sub={breakdown > 0 ? 'needs attention' : 'all clear'}
          icon={AlertTriangle}
          iconColor={breakdown > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}
        />
      </div>

      {/* Condition Pills */}
      <div className="flex flex-wrap gap-2">
        {CONDITIONS.map(({ key, label, dotColor, activeBg }) => {
          const count = stats.by_condition[key] ?? 0;
          if (count === 0) return null;
          const isActive = activeConditions.includes(key);
          return (
            <button
              key={key}
              onClick={() => onConditionToggle(key)}
              className={`
                inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                border transition-colors cursor-pointer select-none
                ${isActive
                  ? activeBg
                  : 'border-transparent bg-muted/60 hover:bg-muted'
                }
              `}
            >
              <span className={`h-2 w-2 rounded-full ${dotColor}`} />
              {label}
              <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini KPI card
// ---------------------------------------------------------------------------
function MiniKpi({
  label,
  value,
  sub,
  icon: Icon,
  iconColor,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconColor: string;
}) {
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{value}</p>
          <p className="text-[11px] text-muted-foreground leading-tight truncate">
            {label} &middot; {sub}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function StatsCardsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="py-0">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <Skeleton className="h-5 w-5 rounded" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>
    </div>
  );
}
