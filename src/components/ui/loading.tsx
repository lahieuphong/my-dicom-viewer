// src/components/ui/loading.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrandLoadingSpinner } from '@/components/ui/brand-loading';
import { cn } from '@/lib/utils';

let scrollLockCount = 0;
let lockedScrollY = 0;
let originalBodyStyle: Partial<CSSStyleDeclaration> | null = null;
let originalHtmlStyle: Partial<CSSStyleDeclaration> | null = null;

function lockPageScroll() {
  if (typeof window === 'undefined') return () => {};

  const html = document.documentElement;
  const body = document.body;

  if (scrollLockCount === 0) {
    lockedScrollY = window.scrollY;
    originalHtmlStyle = {
      overflow: html.style.overflow,
      overscrollBehavior: html.style.overscrollBehavior,
    };
    originalBodyStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      overscrollBehavior: body.style.overscrollBehavior,
    };

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.position = 'fixed';
    body.style.top = `-${lockedScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
  }

  scrollLockCount += 1;

  return () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount > 0) return;

    if (originalHtmlStyle) {
      html.style.overflow = originalHtmlStyle.overflow ?? '';
      html.style.overscrollBehavior = originalHtmlStyle.overscrollBehavior ?? '';
    }

    if (originalBodyStyle) {
      body.style.position = originalBodyStyle.position ?? '';
      body.style.top = originalBodyStyle.top ?? '';
      body.style.left = originalBodyStyle.left ?? '';
      body.style.right = originalBodyStyle.right ?? '';
      body.style.width = originalBodyStyle.width ?? '';
      body.style.overflow = originalBodyStyle.overflow ?? '';
      body.style.overscrollBehavior = originalBodyStyle.overscrollBehavior ?? '';
    }

    window.scrollTo(0, lockedScrollY);
    originalHtmlStyle = null;
    originalBodyStyle = null;
  };
}

export default function Loading({
  message,
  fullScreen = false,
}: {
  message?: string;
  fullScreen?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    return lockPageScroll();
  }, [fullScreen]);

  const content = (
    <div
      className={cn(
        fullScreen
          ? 'fixed inset-0 z-[2147483647] flex h-screen min-h-[100dvh] w-screen items-center justify-center overflow-hidden bg-background text-foreground'
          : 'flex min-h-[220px] items-center justify-center bg-background text-foreground'
      )}
      style={fullScreen ? { height: '100dvh', width: '100vw', touchAction: 'none' } : undefined}
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <BrandLoadingSpinner />
      <span className="sr-only">{message ?? 'Đang tải'}</span>
    </div>
  );

  if (fullScreen && mounted) {
    return createPortal(content, document.body);
  }

  return content;
}

export { Loading };
