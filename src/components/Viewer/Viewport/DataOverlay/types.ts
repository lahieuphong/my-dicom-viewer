import type { Series } from '@/platform/core';

export type ViewportSeriesEntry = {
  files?: readonly unknown[];
  metadata?: Series;
};

export type ViewportSeriesMap = Record<string, ViewportSeriesEntry>;

export type ViewportSeriesOption = {
  uid: string;
  seriesNumber: string;
  description: string;
  modality: string;
  instanceCount: number;
};
