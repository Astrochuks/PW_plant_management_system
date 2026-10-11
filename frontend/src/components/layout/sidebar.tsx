'use client';

/**
 * Dashboard Sidebar Navigation
 *
 * 5 sections: Overview, Plant & Equipment, Projects, Shared, Administration
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
  Wrench,
  FileText,
  Upload,
  Users,
  Building2,
  ArrowRightLeft,
  BarChart3,
  Map,
  ScrollText,
  PanelLeftClose,
  PanelLeft,
  PieChart,
  FolderKanban,
  Lightbulb,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { homePathForRole, isProjectManagerRole, isSiteEngineerRole } from '@/lib/roles';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/providers/auth-provider';
import { useTransferStats, useAdminSiteTransferRequests } from '@/hooks/use-transfers';
import { IS_DEMO } from '@/lib/demo';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * The public demo's entire navigation.
 *
 * Four pages, each fully working on synthetic data. The rest of the app
 * is hidden in demo mode — a visitor clicking into a page that half-works
 * learns less than one who never sees it.
 */
const demoNavItems = [
  { title: 'Dashboard', href: '/', icon: LayoutDashboard },
  { title: 'Fleet Register', href: '/plants', icon: Truck },
  { title: 'Report Generator', href: '/reports/generate', icon: FileText },
  { title: 'Executive Summary', href: '/projects/executive', icon: PieChart },
]

// ── Section: OVERVIEW ─────────────────────────────────────────────────────
const overviewNavItems = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'Insights',
    href: '/insights',
    icon: Lightbulb,
  },
];

// ── Section: PLANT & EQUIPMENT ────────────────────────────────────────────
const plantNavItems = [
  {
    title: 'Fleet Register',
    href: '/plants',
    icon: Truck,
  },
  {
    title: 'Spare Parts',
    href: '/spare-parts',
    icon: Wrench,
    exact: true,
  },
  {
    title: 'Purchase Orders',
    href: '/spare-parts/pos',
    icon: FileText,
    matchPrefix: '/spare-parts/',
  },
  {
    title: 'Transfers',
    href: '/transfers',
    icon: ArrowRightLeft,
    badgeKey: 'transfers' as const,
  },
  {
    title: 'Plant Analytics',
    href: '/spare-parts/analytics',
    icon: PieChart,
  },
  {
    title: 'Repeat Purchases',
    href: '/spare-parts/repeat-purchases',
    icon: AlertTriangle,
  },
  {
    title: 'Price Catalog',
    href: '/spare-parts/price-catalog',
    icon: BookOpen,
  },
];

// ── Section: PROJECTS ─────────────────────────────────────────────────────
const projectNavItems = [
  {
    title: 'Executive Summary',
    href: '/projects/executive',
    icon: LayoutDashboard,
  },
  {
    title: 'Project Registry',
    href: '/projects',
    icon: FolderKanban,
  },
];

// ── Section: MY SITE (site engineer) ──────────────────────────────────────
// The site engineer's whole world is their assigned project. One entry
// today; bills and the weekly form hang off it as the register work lands.
const siteEngineerNavItems = [
  {
    title: 'My Site',
    href: '/my-site',
    icon: MapPin,
  },
];

// ── Section: SHARED ───────────────────────────────────────────────────────
const sharedNavItems = [
  {
    title: 'Sites',
    href: '/locations',
    icon: MapPin,
  },
  {
    title: 'Suppliers',
    href: '/suppliers',
    icon: Building2,
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
  },
];

// ── Section: ADMINISTRATION ───────────────────────────────────────────────
const adminNavItems = [
  {
    title: 'Upload',
    href: '/uploads',
    icon: Upload,
  },
  {
    title: 'Transfer Requests',
    href: '/admin/transfers',
    icon: ArrowRightLeft,
    badgeKey: 'adminTransfers' as const,
  },
  {
    title: 'Users & Roles',
    href: '/admin/users',
    icon: Users,
  },
  {
    title: 'States',
    href: '/admin/states',
    icon: Map,
  },
  {
    title: 'Audit Log',
    href: '/admin/audit',
    icon: ScrollText,
  },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isProjectManager = isProjectManagerRole(user?.role);
  const isSiteEngineer = isSiteEngineerRole(user?.role);
  const isPlantOfficer = user?.role === 'plant_officer';
  // Roles v3: the plant module belongs to admin + plant officer; the
  // projects module to admin + project manager; the site engineer sees only
  // their own site. Nobody straddles modules except the admin.
  const showManagementItems = isAdmin || isPlantOfficer;
  const showProjectItems = isAdmin || isProjectManager;
  const showOverview = isAdmin || isPlantOfficer;

  // Track last visit to transfers page for badge count
  const TRANSFERS_LAST_SEEN_KEY = 'transfers_last_seen_at';
  const [lastSeenAt, setLastSeenAt] = useState<string | undefined>(undefined);

  useEffect(() => {
    const stored = localStorage.getItem(TRANSFERS_LAST_SEEN_KEY);
    setLastSeenAt(stored || undefined);
  }, []);

  useEffect(() => {
    if (pathname.startsWith('/transfers')) {
      const now = new Date().toISOString();
      localStorage.setItem(TRANSFERS_LAST_SEEN_KEY, now);
      setLastSeenAt(now);
    }
  }, [pathname]);

  const { data: transferStats } = useTransferStats(lastSeenAt);
  const newTransfers = transferStats?.data?.new_since ?? 0;

  // Admin-only: pending site transfer requests badge (skip API call for non-admins)
  const { data: siteRequestsData } = useAdminSiteTransferRequests('pending', isAdmin);
  const pendingSiteRequests = siteRequestsData?.count ?? 0;

  const badgeCounts: Record<string, number> = {
    transfers: newTransfers,
    adminTransfers: pendingSiteRequests,
  };

  // Prefetch all nav routes for instant transitions
  useEffect(() => {
    const allItems = IS_DEMO ? demoNavItems : [
      ...(showOverview ? overviewNavItems : []),
      ...(showManagementItems ? plantNavItems : []),
      ...(showProjectItems ? projectNavItems : []),
      ...(isSiteEngineer ? siteEngineerNavItems : []),
      ...(showManagementItems ? sharedNavItems : []),
      ...(isAdmin ? adminNavItems : []),
    ];
    allItems.forEach((item) => router.prefetch(item.href));
  }, [router, isAdmin, isSiteEngineer, showOverview, showManagementItems, showProjectItems]);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 flex flex-col',
        collapsed ? 'w-[70px]' : 'w-[240px]'
      )}
    >
      {/* Logo Section */}
      <div className="flex h-[72px] items-center justify-between px-3 border-b border-sidebar-border">
        <Link href={homePathForRole(user?.role)} className="flex items-center gap-2.5">
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
              <span className="text-[10px] text-muted-foreground">Central Reporting System</span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 p-3 overflow-y-auto">

        {/* DEMO — a deliberately short tour. The public build ships four
            pages that fully work on synthetic data; everything else is
            hidden rather than shown broken. */}
        {IS_DEMO && (
          <NavSection label="DEMO" collapsed={collapsed}>
            {demoNavItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                title={item.title}
                isActive={item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)}
                collapsed={collapsed}
              />
            ))}
          </NavSection>
        )}

        {/* OVERVIEW — the plant-module seats (admin, plant officer) */}
        {!IS_DEMO && showOverview && (
          <NavSection label="OVERVIEW" collapsed={collapsed}>
            {overviewNavItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                title={item.title}
                isActive={item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)}
                collapsed={collapsed}
              />
            ))}
          </NavSection>
        )}

        {/* PLANT & EQUIPMENT — management + admin */}
        {!IS_DEMO && showManagementItems && (
          <NavSection label="PLANT & EQUIPMENT" collapsed={collapsed} separator>
            {plantNavItems.map((item) => {
              const badgeKey = 'badgeKey' in item ? item.badgeKey : undefined;
              const badge = badgeKey ? badgeCounts[badgeKey] : 0;
              let active: boolean;
              if ('exact' in item && item.exact) {
                active = pathname === item.href;
              } else if ('matchPrefix' in item && item.matchPrefix) {
                active = pathname === item.href || pathname.startsWith(item.matchPrefix);
              } else {
                active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              }
              return (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  title={item.title}
                  isActive={active}
                  collapsed={collapsed}
                  badge={badge}
                />
              );
            })}
          </NavSection>
        )}

        {!IS_DEMO && showProjectItems && (
          <NavSection label="PROJECTS" collapsed={collapsed} separator>
            {projectNavItems.map((item) => {
              // each sub-page owns its own prefix; Registry owns the rest
              const owned = ['/projects/executive'];
              const active = owned.includes(item.href)
                ? pathname.startsWith(item.href)
                : pathname.startsWith('/projects') &&
                  !owned.some((o) => pathname.startsWith(o));
              return (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  title={item.title}
                  isActive={active}
                  collapsed={collapsed}
                />
              );
            })}
          </NavSection>
        )}

        {/* MY SITE — the site engineer's own project */}
        {!IS_DEMO && isSiteEngineer && (
          <NavSection label="MY SITE" collapsed={collapsed}>
            {siteEngineerNavItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                title={item.title}
                isActive={pathname.startsWith(item.href)}
                collapsed={collapsed}
              />
            ))}
          </NavSection>
        )}

        {/* SHARED — admin + plant officer */}
        {!IS_DEMO && showManagementItems && (
          <NavSection label="SHARED" collapsed={collapsed} separator>
            {sharedNavItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                title={item.title}
                isActive={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))}
                collapsed={collapsed}
              />
            ))}
          </NavSection>
        )}

        {/* ADMINISTRATION — admin only */}
        {!IS_DEMO && isAdmin && (
          <NavSection label="ADMINISTRATION" collapsed={collapsed} separator>
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
          </NavSection>
        )}
      </nav>

      {/* Collapse Toggle */}
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

// ============================================================================
// NavSection — renders a labelled group with optional separator
// ============================================================================

interface NavSectionProps {
  label: string;
  collapsed: boolean;
  separator?: boolean;
  children: React.ReactNode;
}

function NavSection({ label, collapsed, separator, children }: NavSectionProps) {
  return (
    <>
      {separator && <Separator className="my-3" />}
      <div className="space-y-1">
        {!collapsed && (
          <span className="text-xs font-medium text-muted-foreground px-3 py-2 block">
            {label}
          </span>
        )}
        {children}
      </div>
    </>
  );
}

// ============================================================================
// NavItem — single navigation link with optional badge
// ============================================================================

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
