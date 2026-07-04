'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usePatient } from '@/context/PatientContext';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loading } from '@/components/ui/loading';

export default function PatientLookup() {
  const router = useRouter();
  const { setPatientId } = usePatient();

  const [input, setInput] = useState('');
  const [error, setError] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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

      {/* Title Section */}
      <section className="text-center mb-6">
        <h1 className="text-2xl md:text-4xl font-extrabold text-foreground dark:text-white">
          Tra cứu bệnh án của bạn
        </h1>
        <p className="mt-1 text-base md:text-lg text-muted-foreground">
          Nhập thông tin để xem kết quả khám bệnh và hồ sơ y tế của bạn một cách bảo mật
        </p>
      </section>

      {/* Information banner */}
      <div className="flex items-center w-full max-w-sm md:max-w-md bg-green-50 dark:bg-green-900/30 text-green-900 dark:text-green-200 rounded-lg p-3 mb-6">
        <i
          className="fas fa-shield-alt text-sm md:text-base mr-2"
          aria-hidden="true"
        />
        <span className="text-xs md:text-sm">
          Thông tin của bạn được bảo mật và mã hóa
        </span>
      </div>

      {/* Lookup Card */}
      <Card className="w-full max-w-sm md:max-w-lg p-4 md:p-6 rounded-2xl shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <i className="fas fa-search w-4 h-4 md:w-5 md:h-5 text-muted-foreground" />
            <CardTitle className="text-xl md:text-2xl font-semibold text-foreground dark:text-white">
              Thông tin tra cứu
            </CardTitle>
          </div>
          <Separator className="my-2" />
          <CardDescription className="text-xs md:text-sm text-muted-foreground">
            Nhập mã tra cứu được cung cấp khi bạn khám bệnh
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label
                htmlFor="lookup"
                className="flex items-center gap-2 text-sm md:text-base font-medium text-foreground dark:text-white"
              >
                <i className="fas fa-id-card-alt text-sm md:text-base text-muted-foreground" />
                Tra cứu mã bệnh nhân
              </Label>
              <Input
                id="lookup"
                placeholder="Nhập mã tra cứu..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full h-10 md:h-12 px-3 md:px-4 border-2 border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-400"
                disabled={isPending}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full h-10 md:h-12 text-sm md:text-base font-medium bg-gradient-to-r from-blue-400 to-blue-600 hover:from-muted hover:to-muted hover:text-foreground text-white rounded-md"
              disabled={isPending}
            >
              Tra cứu Bệnh án
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
