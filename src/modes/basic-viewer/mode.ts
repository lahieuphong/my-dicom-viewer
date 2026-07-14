import { CORNERSTONE_EXTENSION_ID } from '@/extensions/cornerstone/manifest';
import { DEFAULT_EXTENSION_ID } from '@/extensions/default/manifest';
import { DICOM_SR_EXTENSION_ID } from '@/extensions/dicom-sr/manifest';
import { STATIC_DICOM_DATA_SOURCE_ID } from '@/extensions/static-dicom-data-source/manifest';

export const BASIC_VIEWER_MODE_ID = 'basic-viewer' as const;

/**
 * Declarative identity for the current single-viewport workflow.
 * The Next.js route uses BasicViewer directly; this descriptor remains
 * metadata-only and therefore has no registration side effects.
 */
export const basicViewerMode = Object.freeze({
  id: BASIC_VIEWER_MODE_ID,
  displayName: 'Basic Viewer',
  routeName: 'viewer',
  dataSourceId: STATIC_DICOM_DATA_SOURCE_ID,
  layout: 'single-stack-viewport' as const,
  extensions: [
    DEFAULT_EXTENSION_ID,
    CORNERSTONE_EXTENSION_ID,
    DICOM_SR_EXTENSION_ID,
  ] as const,
});

export type BasicViewerMode = typeof basicViewerMode;
