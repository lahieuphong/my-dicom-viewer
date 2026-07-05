import type { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import type { StudyFilters } from './types';

const filterKeys = [
  'name',
  'id',
  'date',
  'description',
  'modality',
  'studyUID',
  'accession',
] as const;

type StudiesFilterRowProps = {
  filters: StudyFilters;
  setFilters: Dispatch<SetStateAction<StudyFilters>>;
};

export default function StudiesFilterRow({
  filters,
  setFilters,
}: StudiesFilterRowProps) {
  return (
    <TableRow className="bg-card hover:bg-card !border-b-0 cursor-default">
      <TableCell className="min-w-0" />
      {filterKeys.map((key) => (
        <TableCell key={key} className="min-w-0 md:min-w-full">
          <Input
            placeholder={key.charAt(0).toUpperCase() + key.slice(1)}
            value={filters[key]}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                [key]: event.target.value,
              }))
            }
            className="w-full min-w-[80px] md:min-w-full border border-border bg-background"
          />
        </TableCell>
      ))}
      <TableCell className="min-w-0" />
    </TableRow>
  );
}
