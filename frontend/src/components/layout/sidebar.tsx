'use client';

/**
 * Dashboard Sidebar Navigation
 */

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Truck,
  Wrench,
  FileText,
  MapPin,
  Settings,
  Users,
  Upload,
  Bell,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/providers/auth-provider';

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
    title: 'Spare Parts',
    href: '/spare-parts',
    icon: Wrench,
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: FileText,
  },
  {
    title: 'Locations',
    href: '/locations',
    icon: MapPin,
  },
];

const adminNavItems = [
  {
    title: 'Uploads',
    href: '/uploads',
    icon: Upload,
  },
  {
    title: 'Users',
    href: '/users',
    icon: Users,
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300',
        collapsed ? 'w-[70px]' : 'w-[240px]'
      )}
    >
      {/* Logo Section */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-3">
          <div className="relative w-10 h-10 flex-shrink-0">
            <Image
              src="/images/logo.png"
              alt="PW Nigeria"
              fill
              className="object-contain"
            />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-bold text-sm text-sidebar-foreground">PW NIGERIA</span>
              <span className="text-[10px] text-muted-foreground">Plant Management</span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 p-3">
        {/* Main Navigation */}
        <div className="space-y-1">
          {!collapsed && (
            <span className="text-xs font-medium text-muted-foreground px-3 py-2">
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

        {/* Admin Navigation */}
        {isAdmin && (
          <>
            <Separator className="my-3" />
            <div className="space-y-1">
              {!collapsed && (
                <span className="text-xs font-medium text-muted-foreground px-3 py-2">
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

      {/* Collapse Toggle */}
      <div className="absolute bottom-4 left-0 right-0 px-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className={cn(
            'w-full justify-center text-muted-foreground hover:text-sidebar-foreground',
            collapsed && 'px-2'
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span>Collapse</span>
            </>
          )}
        </Button>
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
}

function NavItem({ href, icon: Icon, title, isActive, collapsed }: NavItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? title : undefined}
    >
      <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-sidebar-primary-foreground')} />
      {!collapsed && <span>{title}</span>}
    </Link>
  );
}
