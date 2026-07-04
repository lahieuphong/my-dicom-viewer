// src/components/ui/loading.tsx
'use client';

import React from 'react';

export default function Loading({
  message,
  fullScreen = false,
}: {
  message?: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      className={`${
        fullScreen
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-background'
          : 'flex items-center justify-center bg-background dark:bg-background'
      }`}
    >
      <div className="flex flex-col items-center space-y-4">
        {/* spinner: neutral muted border with transparent top */}
        <div className="w-12 h-12 border-4 border-muted border-t-transparent rounded-full animate-spin" />
        {message && <p className="text-foreground text-sm">{message}</p>}
      </div>
    </div>
  );
}

export { Loading };