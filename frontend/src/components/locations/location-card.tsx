'use client';

/**
 * Location Card Component
 * Displays location stats in a card format
 */

import { MapPin, Truck, CheckCircle, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { LocationStats } from '@/hooks/use-locations';

interface LocationCardProps {
  location: LocationStats;
  onClick?: () => void;
}

export function LocationCard({ location, onClick }: LocationCardProps) {
  const verificationPercent = Math.round(location.verification_rate * 100);

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
              {location.location_code && (
                <span className="text-xs text-muted-foreground font-mono">
                  {location.location_code}
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
        {/* Plant Status Breakdown */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-success/10 rounded-lg p-2">
            <p className="text-lg font-bold text-success">{location.active_plants}</p>
            <p className="text-[10px] text-muted-foreground">Active</p>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <p className="text-lg font-bold text-muted-foreground">{location.archived_plants}</p>
            <p className="text-[10px] text-muted-foreground">Archived</p>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <p className="text-lg font-bold text-muted-foreground">{location.disposed_plants}</p>
            <p className="text-[10px] text-muted-foreground">Disposed</p>
          </div>
        </div>

        {/* Verification Progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1 text-muted-foreground">
              <CheckCircle className="h-3 w-3" />
              Verification
            </span>
            <span className="font-medium">{verificationPercent}%</span>
          </div>
          <Progress value={verificationPercent} className="h-2" />
          <p className="text-[10px] text-muted-foreground">
            {location.verified_plants} of {location.total_plants} verified
          </p>
        </div>

        {/* Maintenance Stats */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Wrench className="h-3 w-3" />
            Maintenance
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{formatCurrency(location.total_maintenance_cost)}</p>
            <p className="text-[10px] text-muted-foreground">
              {location.total_parts_replaced} parts replaced
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
