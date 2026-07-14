import { redirect } from 'next/navigation';
import { getViewerPath } from '@/extensions/static-dicom-data-source';

type LegacyViewerPageProps = {
  params: Promise<{
    studyUID: string;
  }>;
};

export default async function LegacyViewerPage({ params }: LegacyViewerPageProps) {
  const { studyUID } = await params;
  redirect(getViewerPath(studyUID));
}
