'use client';

/**
 * Dashboard Header
 */

import { useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Moon,
  Sun,
  LogOut,
  User,
  Menu,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/providers/auth-provider';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { NotificationBell } from '@/components/notifications/notification-bell';

interface HeaderProps {
  sidebarCollapsed: boolean;
  onMenuClick?: () => void;
}

export function Header({ sidebarCollapsed, onMenuClick }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useState(() => {
    setMounted(true);
  });

  const getInitials = (name: string | null | undefined, email: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-30 h-16 bg-background border-b border-border transition-all duration-300',
        sidebarCollapsed ? 'left-[70px]' : 'left-[240px]'
      )}
    >
      <div className="flex h-full items-center justify-between px-6">
        {/* Left side - Mobile menu & Date display */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="hidden sm:flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {new Date().toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Week {getISOWeek()}</span>
          </div>
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center gap-2">
          {/* Notifications */}
          <NotificationBell />

          {/* Theme Toggle */}
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>
          )}

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-3 px-2">
                <Avatar className="h-8 w-8 bg-primary">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                    {user ? getInitials(user.full_name, user.email) : '??'}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:flex flex-col items-start">
                  <span className="text-sm font-medium">
                    {user?.full_name || user?.email}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {user?.role}
                  </span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user?.full_name || 'User'}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => logout()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function getISOWeek(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDays = (now.getTime() - startOfYear.getTime()) / 86400000;
  return Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
}
