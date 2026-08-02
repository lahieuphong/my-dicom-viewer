'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { AppFooter, AppHeader } from '@/platform/ui';
import { Alert, AlertTitle } from '@/components/ui/alert';
import Loading from '@/components/ui/loading';
import { StudiesProvider, useStudies } from '@/context/StudiesContext';
import StudiesTable from '../Table';

const BasicViewer = dynamic(
  () => import('@/modes/basic-viewer/BasicViewer').then((module) => module.BasicViewer),
  {
    ssr: false,
    loading: () => <Loading message="Đang tải trình xem DICOM..." />,
  }
);

function StudiesPageContent() {
  const { studies, loading: studiesLoading, error: studiesError } = useStudies();
  const searchParams = useSearchParams();
  const queryPatient = searchParams.get('patientId');
  const studyUID = searchParams.get('study');

  if (studyUID) {
    return (
      <div className="min-h-screen flex flex-col">
        <AppHeader
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
          <BasicViewer studyUID={studyUID} />
        </main>
        <AppFooter />
      </div>
    );
  }

  const filteredStudies = queryPatient
    ? studies.filter((study) => study.patientId === queryPatient)
    : studies;
  const showInitialLoading = studiesLoading && studies.length === 0;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
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
          {showInitialLoading ? (
            <Loading message="Đang tải danh sách studies..." />
          ) : studiesError ? (
            <Alert
              variant="destructive"
              className="mx-auto max-w-2xl border border-red-400 p-4"
            >
              <i className="fas fa-exclamation-triangle text-destructive text-xl" />
              <AlertTitle className="whitespace-normal">
                Không thể tải danh sách studies. Vui lòng kiểm tra kết nối PACS
                hoặc cấu hình nguồn dữ liệu.
              </AlertTitle>
            </Alert>
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

      <AppFooter />
    </div>
  );
}

export default function StudiesPage() {
  return (
    <Suspense fallback={<Loading message="Đang tải trang..." />}>
      <StudiesProvider>
        <StudiesPageContent />
      </StudiesProvider>
    </Suspense>
  );
}
