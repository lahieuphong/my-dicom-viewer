// app/viewer/[studyUID]/page.tsx
'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Viewer from '@/components/Viewer/Viewer';
import SharedHeader from '@/components/shared/Header';

export default function ViewerPage() {
  const raw = useParams().studyUID;
  const studyUID = Array.isArray(raw) ? raw[0] : raw;

  if (!studyUID) {
    return <div className="p-4 text-center">❌ Không tìm thấy Study UID</div>;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* Header cố định, không scroll */}
      <SharedHeader
        showBackButton
        showLogo
        showStudyUID={true}
        studyUID={studyUID}
        showSupport={false}
        showSecurity={false}
        showUserMenu
      />

      {/* Viewer lấp toàn bộ phần còn lại, không scroll */}
      <div className="flex-1">
        {/* KEY: force full remount of Viewer when studyUID changes to avoid stale engine/dom races */}
        <Viewer key={studyUID} studyUID={studyUID} />
      </div>
    </div>
  );
}
