// "Create SR" dialog workflow for the basic-viewer mode.
'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';

export const DEFAULT_SR_DOCUMENT_TITLE = 'Measurement Report';

type UseSrCreateDialogOptions = {
  /** Writes and downloads the report; resolves its UID when one was created. */
  exportReport: (documentTitle: string) => Promise<string | null | undefined>;
  /** The selected series is a loaded SR, which is shown read-only. */
  readOnly: boolean;
  /** True while a measurement is still being drawn or edited. */
  isAnnotationInteractionActive: () => boolean;
};

/**
 * Opens the report-name dialog, runs one export at a time and reports the
 * outcome. A report cannot be started from a read-only SR series or while a
 * measurement is still being drawn, since it would miss that measurement.
 */
export function useSrCreateDialog({
  exportReport,
  readOnly,
  isAnnotationInteractionActive,
}: UseSrCreateDialogOptions) {
  const [isCreatingSr, setIsCreatingSr] = useState(false);
  const [srDialogOpen, setSrDialogOpen] = useState(false);
  const [srNameValue, setSrNameValue] = useState('');
  // The state above updates on the next render; the ref blocks a second
  // export started by a double click in the same frame.
  const isCreatingSrRef = useRef(false);

  const openSrNameDialog = () => {
    if (isCreatingSrRef.current || readOnly) return;
    if (isAnnotationInteractionActive()) {
      toast.error(
        'Vui lòng hoàn tất thao tác vẽ hoặc chỉnh sửa Measurement trước khi tạo SR.'
      );
      return;
    }
    setSrNameValue(DEFAULT_SR_DOCUMENT_TITLE);
    setSrDialogOpen(true);
  };

  const saveSrDialog = async (documentTitle: string) => {
    if (isCreatingSrRef.current) return;

    isCreatingSrRef.current = true;
    setIsCreatingSr(true);
    try {
      const createdReportUID = await exportReport(documentTitle);

      if (createdReportUID) {
        toast.success('Đã tạo và tải xuống DICOM SR.');
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Không thể tạo Structured Report.'
      );
    } finally {
      isCreatingSrRef.current = false;
      setIsCreatingSr(false);
      setSrDialogOpen(false);
      setSrNameValue('');
    }
  };

  const cancelSrDialog = () => {
    setSrDialogOpen(false);
    setSrNameValue('');
  };

  return {
    isCreatingSr,
    srDialogOpen,
    srNameValue,
    openSrNameDialog,
    saveSrDialog,
    cancelSrDialog,
  };
}
