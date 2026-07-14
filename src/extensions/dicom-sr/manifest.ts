export const DICOM_SR_EXTENSION_ID = 'dicom-sr' as const;

export type DicomSrExtensionManifest = Readonly<{
  id: typeof DICOM_SR_EXTENSION_ID;
  sopClass: 'SR';
  capabilities: readonly ['create', 'load', 'display'];
}>;

/** Metadata for the current structured-report compatibility boundary. */
export const dicomSrExtension: DicomSrExtensionManifest = Object.freeze({
  id: DICOM_SR_EXTENSION_ID,
  sopClass: 'SR',
  capabilities: ['create', 'load', 'display'] as const,
});
