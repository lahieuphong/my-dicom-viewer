import type { StudyFilters } from './types';

export type StudyTableColumnId =
  | 'index'
  | 'patientName'
  | 'patientId'
  | 'studyDate'
  | 'studyDescription'
  | 'modalitiesInStudy'
  | 'studyInstanceUID'
  | 'accessionNumber'
  | 'instanceCount';

export type StudyTableColumn = {
  id: StudyTableColumnId;
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  className?: string;
  filterKey?: keyof StudyFilters;
};

export const studyTableColumns: StudyTableColumn[] = [
  {
    id: 'index',
    label: '#',
    defaultWidth: 64,
    minWidth: 52,
    maxWidth: 96,
    className: 'text-center',
  },
  {
    id: 'patientName',
    label: 'Tên bệnh nhân',
    defaultWidth: 210,
    minWidth: 120,
    maxWidth: 420,
    filterKey: 'name',
  },
  {
    id: 'patientId',
    label: 'Mã bệnh nhân',
    defaultWidth: 210,
    minWidth: 130,
    maxWidth: 420,
    filterKey: 'id',
  },
  {
    id: 'studyDate',
    label: 'Ngày chụp',
    defaultWidth: 160,
    minWidth: 120,
    maxWidth: 260,
    filterKey: 'date',
  },
  {
    id: 'studyDescription',
    label: 'Diễn giải',
    defaultWidth: 220,
    minWidth: 140,
    maxWidth: 480,
    filterKey: 'description',
  },
  {
    id: 'modalitiesInStudy',
    label: 'Thiết bị',
    defaultWidth: 160,
    minWidth: 120,
    maxWidth: 260,
    filterKey: 'modality',
  },
  {
    id: 'studyInstanceUID',
    label: 'Study UID',
    defaultWidth: 230,
    minWidth: 150,
    maxWidth: 560,
    filterKey: 'studyUID',
  },
  {
    id: 'accessionNumber',
    label: 'Mã phiếu',
    defaultWidth: 190,
    minWidth: 140,
    maxWidth: 360,
    filterKey: 'accession',
  },
  {
    id: 'instanceCount',
    label: 'Thể hiện',
    defaultWidth: 128,
    minWidth: 92,
    maxWidth: 180,
    className: 'text-center',
  },
];
