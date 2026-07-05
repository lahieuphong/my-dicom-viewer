'use client';

import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import {
  Study,
  fetchStudiesWithMeta,
  getCachedStudies,
  setCachedStudies,
} from '@/lib/pacs/services';

type StudiesCtx = {
  studies: Study[];
  setStudies: React.Dispatch<React.SetStateAction<Study[]>>;
  loading: boolean;
  error: string | null;
};

const StudiesContext = createContext<StudiesCtx | undefined>(undefined);

export function StudiesProvider({ children }: React.PropsWithChildren) {
  const [studies, setStudiesState] = useState<Study[]>(() => getCachedStudies() ?? []);
  const [loading, setLoading] = useState(() => !getCachedStudies());
  const [error, setError] = useState<string | null>(null);

  const setStudies = useCallback<React.Dispatch<React.SetStateAction<Study[]>>>((value) => {
    setStudiesState((current) => {
      const next =
        typeof value === 'function'
          ? (value as (previous: Study[]) => Study[])(current)
          : value;
      setCachedStudies(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const cached = getCachedStudies();
        if (cached) {
          setStudiesState(cached);
          setLoading(false);
          return;
        }

        setError(null);
        const data = await fetchStudiesWithMeta();
        if (!cancelled) {
          setStudiesState(data);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Failed to load studies');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StudiesContext.Provider value={{ studies, setStudies, loading, error }}>
      {children}
    </StudiesContext.Provider>
  );
}

export function useStudies() {
  const ctx = useContext(StudiesContext);
  if (!ctx) throw new Error('useStudies must be inside StudiesProvider');
  return ctx;
}
