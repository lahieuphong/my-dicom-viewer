'use client';

import React, { useTransition } from 'react';
import { Loading } from '@/components/ui/loading';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

export interface SharedHeaderProps {
  showBackButton?: boolean;
  showLogo?: boolean;
  showStudyUID?: boolean;
  showUserMenu?: boolean;
  showSupport?: boolean;
  showSecurity?: boolean;
  studyUID?: string;
}

export default function SharedHeader({
  showBackButton = true,
  showLogo = true,
  showStudyUID = true,
  showUserMenu = true,
  showSupport = true,
  showSecurity = true,
  studyUID,
}: SharedHeaderProps) {
  const router = useRouter();
  const { username, logout } = useAuth(); // ✅ Dùng context
  const { theme, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();

  const handleLogin = () => {
    startTransition(() => {
      router.push('/login');
    });
  };

  const handleToggleTheme = (toDark: boolean) => {
    setTheme(toDark ? 'dark' : 'light');
  };

  const getFallback = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  return (
    <>
      {isPending && <Loading fullScreen message="Đang xử lý, vui lòng chờ..." />}
      <header className="bg-card border-b border-border w-full">
        <div className="max-w-full h-14 flex items-center justify-between px-4 md:px-4 lg:px-6 gap-4">
          {/* LEFT SECTION */}
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-4">
            {showBackButton && (
              <Button
                variant="ghost"
                onClick={() => router.back()}
                className="header-btn flex-shrink-0 border border-border rounded-md p-2 text-sm transition-colors"
              >
                <i className="fas fa-arrow-left" />
                <span className="hidden md:inline ml-1">Quay lại</span>
              </Button>
            )}

            {showLogo && (
              <div className="relative w-36 h-10 md:w-48 md:h-14 flex-shrink-0">
                <Image
                  src="/brand/hvtt-logo.png"
                  alt="HVTT Logo"
                  fill
                  sizes="(min-width: 768px) 192px, 144px"
                  className="object-contain"
                  priority
                />
              </div>
            )}

            {showStudyUID && studyUID && (
              <span
                className="min-w-0 flex-1 truncate text-sm italic text-secondary-foreground"
                title={studyUID}
              >
                Lần chụp: {studyUID}
              </span>
            )}
          </div>

          {/* RIGHT SECTION */}
          {(showSupport || showSecurity || showUserMenu) && (
            <div className="flex shrink-0 items-center gap-2 md:gap-4">
              {showSupport && (
                <Label
                  htmlFor="support"
                  className="flex items-center gap-2 text-sm md:text-base text-green-600 dark:text-green-300 cursor-default"
                >
                  <i className="fas fa-phone-alt text-base" />
                  <div className="hidden md:flex flex-col text-left text-muted-foreground text-xs leading-tight">
                    <span>Hỗ trợ 24/7</span>
                    <span className="font-medium text-foreground">(028) 1234 5678</span>
                  </div>
                </Label>
              )}

              {showSupport && (showSecurity || showUserMenu) && (
                <Separator orientation="vertical" className="hidden md:block" />
              )}

              {showSecurity && (
                <Label
                  htmlFor="security"
                  className="flex items-center gap-2 px-3 py-1.5 text-sm md:text-base font-medium border border-green-600 dark:border-green-300 text-green-600 dark:text-green-300 rounded-md cursor-pointer hover:bg-muted transition-colors"
                >
                  <i className="fas fa-shield-alt text-base" />
                  <span className="hidden md:inline">Bảo mật</span>
                </Label>
              )}

              {showSecurity && showUserMenu && (
                <Separator orientation="vertical" className="hidden md:block" />
              )}

              {showUserMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="p-0 h-10 w-10 rounded-full hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center justify-center p-1 h-full w-full rounded-full bg-gradient-to-tr from-pink-500 via-yellow-500 to-purple-500">
                        <Avatar className="h-8 w-8 bg-card text-foreground">
                          <AvatarFallback>
                            {username ? getFallback(username) : 'HP'}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent className="w-48 bg-card text-foreground border border-border">
                    <div className="flex items-center px-4 py-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          {username ? getFallback(username) : 'HP'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="ml-2 font-medium">
                        {username ?? 'HVTT PACS'}
                      </span>
                    </div>

                    <DropdownMenuSeparator />

                    {username === null && (
                      <DropdownMenuItem
                        onClick={handleLogin}
                        className="px-4 py-2 flex items-center text-sm"
                      >
                        <i className="fas fa-sign-in-alt" />
                        Đăng nhập
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="px-4 py-2 flex items-center text-sm">
                        <i className="fas fa-adjust mr-2" />
                        Chế độ
                      </DropdownMenuSubTrigger>

                      <DropdownMenuPortal>
                        <DropdownMenuSubContent className="min-w-[140px]">
                          <DropdownMenuRadioGroup
                            value={theme}
                            onValueChange={(value) =>
                              handleToggleTheme(value === 'dark')
                            }
                          >
                            <DropdownMenuRadioItem
                              value="light"
                              className="px-4 py-2 pl-8 flex items-center text-sm"
                            >
                              <i className="fas fa-sun" />
                              Sáng
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem
                              value="dark"
                              className="px-4 py-2 pl-8 flex items-center text-sm"
                            >
                              <i className="fas fa-moon" />
                              Tối
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>

                    {username && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={logout} // ✅ Dùng logout từ context
                          className="px-4 py-2 flex items-center text-sm text-destructive"
                        >
                          <i className="fas fa-sign-out-alt" />
                          Đăng xuất
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
      </header>
    </>
  );
}
