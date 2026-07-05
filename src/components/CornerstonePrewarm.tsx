// src/components/CornerstonePrewarm.tsx
'use client';
import { useEffect } from 'react';
import { initCornerstone } from '@/lib/cornerstone';

export default function CornerstonePrewarm() {
  useEffect(() => {
    (async () => {
      try {
        // Avoid double work if something else called it already.
        if ((window as any).__cornerstonePrewarmDone) {
          return;
        }

        await initCornerstone();
        (window as any).__cornerstonePrewarmDone = true;
      } catch (e) {
      }
    })();
  }, []);
  return null;
}
