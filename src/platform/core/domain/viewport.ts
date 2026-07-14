import type { RegisteredDisplaySet } from './display-set';

export type ViewportId = string;

export type ViewportStatus =
  | 'unmounted'
  | 'mounting'
  | 'ready'
  | 'loading'
  | 'error'
  | 'disposed';

export interface ViewportSnapshot {
  viewportId: ViewportId;
  status: ViewportStatus;
  displaySet?: RegisteredDisplaySet;
  imageIndex: number;
  imageCount: number;
  error?: unknown;
}

export interface SetDisplaySetOptions {
  imageIndex?: number;
  preservePresentation?: boolean;
}
