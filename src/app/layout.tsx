// src/app/layout.tsx
import './globals.css';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import { PatientProvider } from '@/context/PatientContext';
import { StudiesProvider } from '@/context/StudiesContext';

import { Toaster } from 'sonner';
import CornerstonePrewarm from '@/components/CornerstonePrewarm';

export const metadata = {
  title: 'DICOM Viewer',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <title>{metadata.title}</title>
        <link rel="icon" href="/HVTT.ico" />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="transition-colors duration-300">
        {/* Client component sẽ prewarm Cornerstone (tools + loader) */}
        <CornerstonePrewarm />
        <ThemeProvider>
          <AuthProvider>
            <PatientProvider>
              <StudiesProvider>
                <div className="flex-1 flex flex-col min-h-0">
                  {children}
                </div>
              </StudiesProvider>
            </PatientProvider>
          </AuthProvider>
        </ThemeProvider>

        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
