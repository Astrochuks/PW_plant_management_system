'use client';

/**
 * Login Page - Split Screen Design
 * Left: Branding panel with logo and company info
 * Right: Login form
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useAuth } from '@/providers/auth-provider';

// Form validation schema
const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(6, 'Password must be at least 6 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(data: LoginFormValues) {
    setIsLoading(true);
    try {
      await login(data);
      toast.success('Welcome back!', {
        description: 'You have successfully signed in.',
      });
    } catch (error) {
      toast.error('Sign in failed', {
        description: error instanceof Error ? error.message : 'Please check your credentials and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#101415] overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0">
          {/* Geometric grid pattern */}
          <div 
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,191,54,0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,191,54,0.3) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
            }}
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#101415] via-[#101415] to-[#1a1d1e]" />
          {/* Gold accent shapes */}
          <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-[#ffbf36]/5 blur-3xl" />
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[#ffbf36]/5 blur-3xl" />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center items-center w-full px-12">
          {/* Logo and Company Info */}
          <div className="flex flex-col items-center text-center">
            {/* Logo */}
            <div className="mb-8">
              <div className="w-32 h-32 relative">
                <Image
                  src="/images/logo.png"
                  alt="PW Nigeria Logo"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
            </div>

            {/* Company Name */}
            <h1 className="text-4xl font-bold text-white tracking-tight mb-3">
              PW NIGERIA LTD
            </h1>

            {/* Tagline */}
            <p className="text-[#ffbf36] text-lg font-medium tracking-wide">
              Your Engineering Partner in Africa
            </p>

            {/* Separator */}
            <div className="w-24 h-1 bg-[#ffbf36] rounded-full mt-8 mb-8" />

            {/* Description */}
            <p className="text-gray-400 text-center max-w-md leading-relaxed">
              Comprehensive plant and equipment management system for tracking 
              and maintaining your fleet across all project sites.
            </p>
          </div>

          {/* Stats or Features */}
          <div className="mt-16 grid grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-3xl font-bold text-[#ffbf36]">250+</div>
              <div className="text-sm text-gray-500 mt-1">Plants Tracked</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-[#ffbf36]">20+</div>
              <div className="text-sm text-gray-500 mt-1">Active Sites</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-[#ffbf36]">99.9%</div>
              <div className="text-sm text-gray-500 mt-1">Uptime</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-8 left-0 right-0 text-center">
          <p className="text-gray-600 text-sm">
            © {new Date().getFullYear()} PW Nigeria Ltd. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile Logo - Only shown on smaller screens */}
          <div className="lg:hidden flex flex-col items-center mb-10">
            <div className="w-20 h-20 relative mb-4">
              <Image
                src="/images/logo.png"
                alt="PW Nigeria Logo"
                fill
                className="object-contain"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold text-foreground">PW NIGERIA LTD</h1>
            <p className="text-sm text-[#ffbf36]">Your Engineering Partner in Africa</p>
          </div>

          {/* Form Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-foreground tracking-tight">
              Welcome back
            </h2>
            <p className="text-muted-foreground mt-2">
              Sign in to your account to continue
            </p>
          </div>

          {/* Login Form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Email Field */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Email address</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="name@pwnigeriaeng.com"
                        autoComplete="email"
                        disabled={isLoading}
                        className="h-12 bg-background border-input focus:border-[#ffbf36] focus:ring-[#ffbf36]/20 transition-colors"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Password Field */}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Enter your password"
                          autoComplete="current-password"
                          disabled={isLoading}
                          className="h-12 pr-12 bg-background border-input focus:border-[#ffbf36] focus:ring-[#ffbf36]/20 transition-colors"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Forgot Password Link */}
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground hover:text-[#ffbf36] transition-colors"
                >
                  Forgot your password?
                </Link>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 bg-[#ffbf36] hover:bg-[#e6ac31] text-[#101415] font-semibold text-base transition-all duration-200 shadow-lg shadow-[#ffbf36]/20 hover:shadow-[#ffbf36]/30"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </form>
          </Form>

          {/* Help Text */}
          <div className="mt-8 pt-6 border-t border-border text-center">
            <p className="text-sm text-muted-foreground">
              Need help accessing your account?{' '}
              <a
                href="mailto:support@pwnigeriaeng.com"
                className="text-[#ffbf36] hover:underline font-medium"
              >
                Contact support
              </a>
            </p>
          </div>

          {/* Theme Toggle - Small indicator */}
          <div className="mt-6 text-center">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

// Simple theme toggle component
function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useThemeState();

  // Avoid hydration mismatch
  useState(() => {
    setMounted(true);
  });

  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
    </button>
  );
}

// Hook to use theme without importing next-themes directly
function useThemeState() {
  const [theme, setThemeState] = useState<string>('light');

  useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('pw-theme') || 'light';
      setThemeState(savedTheme);
    }
  });

  const setTheme = (newTheme: string) => {
    setThemeState(newTheme);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pw-theme', newTheme);
      document.documentElement.classList.toggle('dark', newTheme === 'dark');
    }
  };

  return { theme, setTheme };
}
