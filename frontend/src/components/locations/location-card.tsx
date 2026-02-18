'use client';

/**
 * Location Card Component
 * Displays location stats in a card format
 */

import { MapPin, Truck, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { LocationStats } from '@/hooks/use-locations';

interface LocationCardProps {
  location: LocationStats;
  onClick?: () => void;
}

export function LocationCard({ location, onClick }: LocationCardProps) {
  return (
    <Card
      className={onClick ? 'cursor-pointer hover:border-primary/50 transition-colors' : ''}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{location.location_name}</CardTitle>
              {location.state_name && (
                <span className="text-xs text-muted-foreground">
                  {location.state_name}
                </span>
              )}
            </div>
          </div>
          <Badge variant="secondary" className="text-xs">
            {location.total_plants} plants
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Plant Condition Breakdown */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-emerald-50 dark:bg-emerald-950 rounded-lg p-2">
            <p className="text-lg font-bold text-emerald-600">{location.working_plants}</p>
            <p className="text-[10px] text-muted-foreground">Working</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-2">
            <p className="text-lg font-bold text-amber-600">{location.standby_plants}</p>
            <p className="text-[10px] text-muted-foreground">Standby</p>
          </div>
          <div className="bg-red-50 dark:bg-red-950 rounded-lg p-2">
            <p className="text-lg font-bold text-red-600">{location.breakdown_plants}</p>
            <p className="text-[10px] text-muted-foreground">Breakdown</p>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="flex items-center justify-between pt-2 border-t text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Truck className="h-3 w-3" />
            Off Hire: <span className="font-medium text-foreground">{location.off_hire_plants}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <CheckCircle className="h-3 w-3" />
            Unverified: <span className="font-medium text-foreground">{location.unverified_plants}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
