'use client';

/**
 * Dashboard Layout - Wraps sidebar, header, and main content
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { useAuth } from '@/providers/auth-provider';
import { useLocations, useFleetTypes } from '@/hooks/use-plants';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import Image from 'next/image';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();

  // Load sidebar state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved) {
      setSidebarCollapsed(JSON.parse(saved));
    }
  }, []);

  // Save sidebar state to localStorage
  const handleSidebarToggle = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', JSON.stringify(newState));
  };

  // Prefetch locations & fleet types as soon as user is authenticated.
  // These are used on the plants page and rarely change — fetching them
  // here means they're already cached when the user navigates to /plants.
  useLocations();
  useFleetTypes();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 relative">
            <Image
              src="/images/logo.png"
              alt="P.W. Nigeria"
              fill
              className="object-contain"
            />
          </div>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated — show spinner while redirecting to prevent blank flash
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Sidebar collapsed={sidebarCollapsed} onToggle={handleSidebarToggle} />
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-[240px] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar collapsed={false} onToggle={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Header */}
      <Header
        sidebarCollapsed={sidebarCollapsed}
        onMenuClick={() => setMobileMenuOpen(true)}
        unreadNotifications={0} // TODO: Connect to real data
      />

      {/* Main Content */}
      <main
        className={cn(
          'pt-16 min-h-screen transition-all duration-300',
          sidebarCollapsed ? 'lg:pl-[70px]' : 'lg:pl-[240px]'
        )}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
