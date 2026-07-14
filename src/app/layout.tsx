// src/app/layout.tsx
import './globals.css';
import { AppProviders } from './providers';

export const metadata = {
  title: 'DICOM Viewer',
};

const themeInitScript = `
(function() {
  try {
    var storedTheme = window.localStorage.getItem('theme');
    var theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
    var root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full dark" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <title>{metadata.title}</title>
        <link rel="icon" href="/brand/favicon.ico" />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-full bg-background text-foreground transition-colors duration-300">
        <AppProviders>
          <div className="flex-1 flex flex-col min-h-0">{children}</div>
        </AppProviders>
      </body>
    </html>
  );
}
