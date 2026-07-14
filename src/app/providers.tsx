'use client';

import type { PropsWithChildren } from 'react';

import { AuthProvider } from '@/features/auth';
import { PatientProvider } from '@/features/patients';
import { ThemeProvider, Toaster } from '@/platform/ui';

/**
 * Application-wide providers kept outside the route layout so routing remains
 * a thin Next.js adapter. Provider order matches the previous layout exactly.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PatientProvider>{children}</PatientProvider>
      </AuthProvider>

      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}
