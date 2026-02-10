/**
 * Dashboard Layout Route
 * Wraps all dashboard pages with sidebar and header
 */

import { DashboardLayout } from '@/components/layout/dashboard-layout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
