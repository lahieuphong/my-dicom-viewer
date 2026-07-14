'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card, CardHeader, CardTitle, CardDescription,
  CardContent, CardFooter
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/features/auth';
import { AppFooter, AppHeader } from '@/platform/ui';
import { toast } from 'sonner';

export default function LoginPage() {
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fallback, setFallback] = useState('HP');

  useEffect(() => {
    const u = localStorage.getItem('username');
    if (u) {
      setUsername(u);
      setFallback(getFallback(u));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserID: username, Password: password }),
      });

      const result = await res.json();

      if (!res.ok || result.result !== 1) {
        const msg = typeof result.data === 'string'
          ? result.data
          : result.data?.message || 'Đăng nhập thất bại';
        throw new Error(msg);
      }

      // ✅ Gọi login từ context
      login(result.data.token, username);
      return;
    } catch (err: any) {
      toast.error(err.message || 'Đã có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  };

  const getFallback = (name: string) =>
    name
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="flex flex-col h-screen">
      <AppHeader
        showBackButton
        showLogo
        showStudyUID={false}
        showSupport={false}
        showSecurity={false}
        showUserMenu
      />

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 md:px-12 py-8 sm:py-12">
        {loading && <Loading fullScreen message="Đang đăng nhập..." />}

        <Card className="w-full max-w-sm sm:max-w-md md:max-w-lg border border-gray-200 dark:border-zinc-700 shadow-xl">
          <CardHeader className="pt-6 pb-4 px-4 sm:px-6">
            <CardTitle className="text-xl sm:text-2xl font-semibold text-center">
              Đăng nhập
            </CardTitle>
            <CardDescription className="text-center text-sm sm:text-base">
              Vui lòng nhập thông tin để tiếp tục
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4 px-4 sm:px-6 py-2">
              <div className="space-y-1">
                <Label htmlFor="username">Tên đăng nhập</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={e => {
                    setUsername(e.target.value);
                    setFallback(getFallback(e.target.value));
                  }}
                  required
                  placeholder="Nhập tên đăng nhập..."
                  className="h-10 sm:h-12"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="password">Mật khẩu</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="Nhập mật khẩu..."
                    className="h-10 sm:h-12 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <i className="fas fa-eye-slash text-gray-500 dark:text-zinc-400" />
                    ) : (
                      <i className="fas fa-eye text-gray-500 dark:text-zinc-400" />
                    )}
                  </button>
                </div>
              </div>
            </CardContent>

            <CardFooter className="px-4 sm:px-6 pt-4 pb-6">
              <Button
                type="submit"
                className="w-full h-10 sm:h-12 text-sm sm:text-base"
                disabled={loading}
              >
                {loading ? `Đang đăng nhập với ${fallback}…` : 'Đăng nhập'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </main>

      <AppFooter />
      <Toaster />
    </div>
  );
}
