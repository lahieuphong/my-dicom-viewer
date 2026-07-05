'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui/loading';
import { usePatient } from '@/context/PatientContext';
import PatientLookupForm from './PatientLookupForm';
import PatientLookupIntro from './PatientLookupIntro';
import PatientSecurityNotice from './PatientSecurityNotice';

export default function PatientLookup() {
  const router = useRouter();
  const { setPatientId } = usePatient();

  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const trimmed = input.trim();
    if (!trimmed) {
      setError('Vui lòng nhập mã tra cứu');
      return;
    }

    startTransition(() => {
      setPatientId(trimmed);
      router.push(`/studies?patientId=${encodeURIComponent(trimmed)}`);
    });
  };

  return (
    <div className="flex flex-col items-center px-4 py-6">
      {isPending && <Loading fullScreen message="Đang tra cứu, vui lòng chờ…" />}

      <PatientLookupIntro />
      <PatientSecurityNotice />
      <PatientLookupForm
        input={input}
        error={error}
        isPending={isPending}
        onInputChange={setInput}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
