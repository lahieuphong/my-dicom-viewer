'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

type PatientCtx = {
  patientId: string | null;
  setPatientId: (id: string) => void;
};

const PatientContext = createContext<PatientCtx | undefined>(undefined);

export function PatientProvider({ children }: { children: ReactNode }) {
  const [patientId, setPatientId] = useState<string | null>(null);
  return (
    <PatientContext.Provider value={{ patientId, setPatientId }}>
      {children}
    </PatientContext.Provider>
  );
}

export function usePatient() {
  const ctx = useContext(PatientContext);
  if (!ctx) throw new Error('usePatient must be inside PatientProvider');
  return ctx;
}
