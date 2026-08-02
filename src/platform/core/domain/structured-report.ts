/**
 * A locally-created DICOM SR display set.
 *
 * The report is secondary content: `sourceSeriesInstanceUID` identifies the
 * image series that remains mounted in the primary viewport while the SR
 * measurements are hydrated as a read-only overlay.
 */
export interface StructuredReportInstance {
  sopInstanceUID: string;
  sopClassUID: string;
  seriesInstanceUID: string;
}

export interface LocalStructuredReport {
  id: string;
  label: string;
  count: number;
  seriesNumber: string;
  sourceSeriesInstanceUID: string;
  instances: StructuredReportInstance[];
}
