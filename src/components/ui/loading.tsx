// src/components/ui/loading.tsx
'use client';

import React from 'react';
import { BrandLoadingSpinner } from '@/components/ui/brand-loading';
import { cn } from '@/lib/utils';

export default function Loading({
  message,
  fullScreen = false,
}: {
  message?: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      className={cn(
        fullScreen
          ? 'fixed inset-0 z-[80] flex items-center justify-center bg-background text-foreground'
          : 'flex min-h-[220px] items-center justify-center bg-background text-foreground'
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <BrandLoadingSpinner />
      <span className="sr-only">{message ?? 'Đang tải'}</span>
    </div>
  );
}

export { Loading };
