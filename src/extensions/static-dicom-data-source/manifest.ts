export const STATIC_DICOM_DATA_SOURCE_ID = 'static-dicom' as const;

export const staticDicomDataSourceExtension = Object.freeze({
  id: STATIC_DICOM_DATA_SOURCE_ID,
  kind: 'data-source' as const,
  transport: 'rest-manifest' as const,
});

export type StaticDicomDataSourceExtension =
  typeof staticDicomDataSourceExtension;
