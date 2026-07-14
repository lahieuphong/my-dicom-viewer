import type {
  DicomInstance,
  DicomSeries,
  DicomStudy,
  DisplaySet,
} from '../domain';
import type { MaybePromise, OperationSignal } from './disposable';

export interface SopClassHandlerContext {
  study: DicomStudy;
  series: DicomSeries;
  instances: readonly DicomInstance[];
  signal?: OperationSignal;
}

/**
 * Converts one DICOM series into zero, one or many display sets.  This is the
 * compile-time extension seam for Stack and SR handlers.
 */
export interface SopClassHandler {
  readonly id: string;
  readonly priority?: number;
  supports(context: SopClassHandlerContext): MaybePromise<boolean>;
  createDisplaySets(context: SopClassHandlerContext): MaybePromise<DisplaySet[]>;
}
