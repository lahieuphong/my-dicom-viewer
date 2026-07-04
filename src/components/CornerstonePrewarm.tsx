// src/components/CornerstonePrewarm.tsx
'use client';
import { useEffect } from 'react';
import { initCornerstone } from '@/lib/cornerstone';

export default function CornerstonePrewarm() {
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // avoid double work in dev if something else called it already
        if ((window as any).__cornerstonePrewarmDone) {
          if (process.env.NODE_ENV === 'development') {
            console.debug('[CornerstonePrewarm] already done, skipping');
          }
          return;
        }

        await initCornerstone();
        (window as any).__cornerstonePrewarmDone = true;

        if (mounted && process.env.NODE_ENV === 'development') {
          console.debug('[CornerstonePrewarm] initCornerstone done — __cornerstonePrewarmDone = true');
        }
      } catch (e) {
        console.warn('[CornerstonePrewarm] init failed', e);
      }
    })();
    return () => { mounted = false; };
  }, []);
  return null;
}
