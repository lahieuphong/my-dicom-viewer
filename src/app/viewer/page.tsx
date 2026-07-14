import { BasicViewer } from '@/modes/basic-viewer/BasicViewer';
import { AppHeader } from '@/platform/ui/app-shell';

type ViewerPageProps = {
  searchParams: Promise<{
    StudyInstanceUIDs?: string | string[];
  }>;
};

function getStudyInstanceUIDs(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

export default async function ViewerPage({ searchParams }: ViewerPageProps) {
  const { StudyInstanceUIDs } = await searchParams;
  const studyInstanceUIDs = getStudyInstanceUIDs(StudyInstanceUIDs);
  const studyUID = studyInstanceUIDs[0];

  if (!studyUID) {
    return <div className="p-4 text-center">❌ Không tìm thấy Study Instance UID</div>;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        showBackButton
        showLogo
        showStudyUID
        studyUID={studyUID}
        showSupport={false}
        showSecurity={false}
        showUserMenu
      />

      <div className="min-h-0 flex-1">
        <BasicViewer key={studyUID} studyUID={studyUID} />
      </div>
    </div>
  );
}
