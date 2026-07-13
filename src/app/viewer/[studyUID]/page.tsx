import { redirect } from 'next/navigation';
import { getViewerPath } from '@/lib/pacs/services';

type LegacyViewerPageProps = {
  params: Promise<{
    studyUID: string;
  }>;
};

export default async function LegacyViewerPage({ params }: LegacyViewerPageProps) {
  const { studyUID } = await params;
  redirect(getViewerPath(studyUID));
}
