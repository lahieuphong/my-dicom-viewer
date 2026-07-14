import type { Series, Study } from '@/platform/core';

export interface StudiesTableProps {
  data: Study[];
}

export interface Instance {
  sopInstanceUID?: string;
  instanceNumber?: number | null;
  url?: string;
  filename?: string;
}

export type SeriesWithInstances = Series & {
  instances?: (Instance | string)[];
};

export type StudyFilters = {
  name: string;
  id: string;
  date: string;
  description: string;
  modality: string;
  studyUID: string;
  accession: string;
};

export const emptyStudyFilters: StudyFilters = {
  name: '',
  id: '',
  date: '',
  description: '',
  modality: '',
  studyUID: '',
  accession: '',
};
