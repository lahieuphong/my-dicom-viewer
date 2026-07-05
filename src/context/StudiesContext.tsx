'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Study, fetchStudiesWithMeta } from '@/lib/pacs/services';

type StudiesCtx = {
  studies: Study[];
  setStudies: React.Dispatch<React.SetStateAction<Study[]>>;
};

const StudiesContext = createContext<StudiesCtx | undefined>(undefined);

export function StudiesProvider({ children }: React.PropsWithChildren) {
  const [studies, setStudies] = useState<Study[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchStudiesWithMeta(); // ✅ Log client-side
        setStudies(data);
      } catch (error) {
      }
    })();
  }, []);

  return (
    <StudiesContext.Provider value={{ studies, setStudies }}>
      {children}
    </StudiesContext.Provider>
  );
}

export function useStudies() {
  const ctx = useContext(StudiesContext);
  if (!ctx) throw new Error('useStudies must be inside StudiesProvider');
  return ctx;
}
