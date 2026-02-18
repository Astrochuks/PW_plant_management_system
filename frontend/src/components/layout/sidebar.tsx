'use client';

/**
 * Dashboard Sidebar Navigation
 */

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Truck,
  MapPin,
  Upload,
  Users,
  ArrowRightLeft,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/providers/auth-provider';
import { useTransferStats } from '@/hooks/use-transfers';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const mainNavItems = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'Plants',
    href: '/plants',
    icon: Truck,
  },
  {
    title: 'Sites',
    href: '/locations',
    icon: MapPin,
  },
];

// Visible to both management and admin
const managementNavItems = [
  {
    title: 'Transfers',
    href: '/transfers',
    icon: ArrowRightLeft,
    badgeKey: 'transfers' as const,
  },
];

// Admin-only items
const adminNavItems = [
  {
    title: 'Upload',
    href: '/uploads',
    icon: Upload,
  },
  {
    title: 'Users',
    href: '/admin/users',
    icon: Users,
  },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isManagement = user?.role === 'management';
  const showManagementItems = isAdmin || isManagement;

  // Track last visit to transfers page for badge count
  const TRANSFERS_LAST_SEEN_KEY = 'transfers_last_seen_at';
  const [lastSeenAt, setLastSeenAt] = useState<string | undefined>(undefined);

  // Load last seen timestamp from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(TRANSFERS_LAST_SEEN_KEY);
    setLastSeenAt(stored || undefined);
  }, []);

  // When user navigates to /transfers, save the current time
  useEffect(() => {
    if (pathname.startsWith('/transfers')) {
      const now = new Date().toISOString();
      localStorage.setItem(TRANSFERS_LAST_SEEN_KEY, now);
      setLastSeenAt(now);
    }
  }, [pathname]);

  // Fetch transfer stats with "since" to get new_since count
  const { data: transferStats } = useTransferStats(lastSeenAt);
  const newTransfers = transferStats?.data?.new_since ?? 0;

  const badgeCounts: Record<string, number> = {
    transfers: newTransfers,
  };

  // Prefetch all nav routes so page transitions are instant
  useEffect(() => {
    mainNavItems.forEach((item) => router.prefetch(item.href));
    if (showManagementItems) {
      managementNavItems.forEach((item) => router.prefetch(item.href));
    }
    if (isAdmin) {
      adminNavItems.forEach((item) => router.prefetch(item.href));
    }
  }, [router, isAdmin, showManagementItems]);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 flex flex-col',
        collapsed ? 'w-[70px]' : 'w-[240px]'
      )}
    >
      {/* Logo Section */}
      <div className="flex h-[72px] items-center justify-between px-3 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="relative w-[46px] h-[46px] flex-shrink-0">
            <Image
              src="/images/logo.png"
              alt="P.W. Nigeria Ltd."
              fill
              className="object-contain"
            />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-bold text-[13px] leading-tight text-sidebar-foreground">P.W. NIGERIA LTD.</span>
              <span className="text-[10px] text-muted-foreground">Plant Management</span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 p-3 overflow-y-auto">
        {/* Main Navigation */}
        <div className="space-y-1">
          {!collapsed && (
            <span className="text-xs font-medium text-muted-foreground px-3 py-2 block">
              MAIN MENU
            </span>
          )}
          {mainNavItems.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              title={item.title}
              isActive={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))}
              collapsed={collapsed}
            />
          ))}
        </div>

        {/* Management Navigation (visible to management + admin) */}
        {showManagementItems && (
          <>
            <Separator className="my-3" />
            <div className="space-y-1">
              {!collapsed && (
                <span className="text-xs font-medium text-muted-foreground px-3 py-2 block">
                  MANAGEMENT
                </span>
              )}
              {managementNavItems.map((item) => {
                const badgeKey = 'badgeKey' in item ? item.badgeKey : undefined;
                const badge = badgeKey ? badgeCounts[badgeKey] : 0;
                return (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    icon={item.icon}
                    title={item.title}
                    isActive={pathname.startsWith(item.href)}
                    collapsed={collapsed}
                    badge={badge}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Admin Navigation */}
        {isAdmin && (
          <>
            <Separator className="my-3" />
            <div className="space-y-1">
              {!collapsed && (
                <span className="text-xs font-medium text-muted-foreground px-3 py-2 block">
                  ADMINISTRATION
                </span>
              )}
              {adminNavItems.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  title={item.title}
                  isActive={pathname.startsWith(item.href)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Collapse Toggle - Always visible at bottom */}
      <div className="border-t border-sidebar-border p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
              className={cn(
                'w-full justify-center text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent',
                collapsed ? 'px-2' : 'gap-2'
              )}
            >
              {collapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  <span>Collapse Sidebar</span>
                </>
              )}
            </Button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              Expand Sidebar
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  );
}

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  title: string;
  isActive: boolean;
  collapsed: boolean;
  badge?: number;
}

function NavItem({ href, icon: Icon, title, isActive, collapsed, badge }: NavItemProps) {
  const linkContent = (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors relative',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        collapsed && 'justify-center px-2'
      )}
    >
      <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-sidebar-primary-foreground')} />
      {!collapsed && (
        <span className="flex-1">{title}</span>
      )}
      {badge != null && badge > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full text-[10px] font-bold leading-none',
            collapsed
              ? 'absolute -top-1 -right-1 h-4 min-w-[16px] px-0.5 bg-red-500 text-white'
              : 'h-5 min-w-[20px] px-1.5 bg-red-500 text-white'
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {linkContent}
        </TooltipTrigger>
        <TooltipContent side="right">
          {title}
          {badge != null && badge > 0 && (
            <span className="ml-1 text-red-400">({badge})</span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return linkContent;
}
