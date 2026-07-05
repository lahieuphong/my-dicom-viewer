'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Viewer from '@/components/Viewer/Viewer';
import SharedFooter from '@/components/shared/Footer';
import SharedHeader from '@/components/shared/Header';
import { Alert, AlertTitle } from '@/components/ui/alert';
import Loading from '@/components/ui/loading';
import { useStudies } from '@/context/StudiesContext';
import StudiesTable from '../Table';

function StudiesPageContent() {
  const { studies } = useStudies();
  const searchParams = useSearchParams();
  const queryPatient = searchParams.get('patientId');
  const studyUID = searchParams.get('study');
  const loading = studies.length === 0 && !queryPatient;

  if (studyUID) {
    return (
      <div className="min-h-screen flex flex-col">
        <SharedHeader
          showBackButton
          showLogo
          showStudyUID={false}
          showSupport={false}
          showSecurity={false}
          showUserMenu
        />
        <main className="flex-1 px-4 py-6 md:px-10 md:py-8">
          <h1 className="text-2xl md:text-4xl font-bold mb-4 text-foreground">
            Viewer cho Study
          </h1>
          <Viewer studyUID={studyUID} />
        </main>
        <SharedFooter />
      </div>
    );
  }

  const filteredStudies = queryPatient
    ? studies.filter((study) => study.patientId === queryPatient)
    : studies;

  return (
    <div className="min-h-screen flex flex-col">
      <SharedHeader
        showBackButton
        showLogo
        showStudyUID={false}
        showSupport={false}
        showSecurity={false}
        showUserMenu
      />

      <main className="flex-1 px-4 py-6 md:px-10 md:py-8 space-y-6">
        <section className="text-center px-2">
          <h1 className="text-2xl md:text-4xl font-bold mb-2 text-foreground">
            Hệ thống PACS
          </h1>
          <p className="max-w-lg mx-auto text-base md:text-lg text-secondary-foreground">
            Hệ thống PACS là hệ thống quản lý và hiển thị hình ảnh DICOM.
          </p>
        </section>

        <div className="flex flex-col items-center md:flex-row md:justify-between md:items-center gap-2 md:gap-0 px-2 text-center md:text-left">
          <h2 className="text-xl md:text-2xl font-bold text-foreground">
            Danh sách
          </h2>
          <h2 className="text-xl md:text-2xl font-bold text-primary">
            {filteredStudies.length} Studies
          </h2>
        </div>

        <div className="px-2 relative min-h-[200px]">
          {loading ? (
            <Loading message="Đang tải danh sách studies..." />
          ) : (
            <>
              <StudiesTable data={filteredStudies} />

              {queryPatient && filteredStudies.length === 0 && (
                <Alert
                  variant="destructive"
                  className="text-center mt-4 md:mt-6 flex flex-col items-center justify-center gap-2 border border-red-400 rounded-md p-4 bg-red-50 overflow-visible"
                >
                  <i className="fas fa-exclamation-triangle text-destructive text-2xl" />
                  <AlertTitle className="text-lg md:text-xl m-0 block whitespace-normal break-words">
                    Không tìm thấy study nào cho mã bệnh nhân{' '}
                    <strong>{queryPatient}</strong> !!!
                  </AlertTitle>
                </Alert>
              )}
            </>
          )}
        </div>
      </main>

      <SharedFooter />
    </div>
  );
}

export default function StudiesPage() {
  return (
    <Suspense fallback={<Loading message="Đang tải trang..." />}>
      <StudiesPageContent />
    </Suspense>
  );
}
