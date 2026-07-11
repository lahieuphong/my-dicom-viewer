import type { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { studyTableColumns, type StudyTableColumnId } from './columns';
import type { StudyFilters } from './types';

type StudiesFilterRowProps = {
  filters: StudyFilters;
  highlightedColumnId: StudyTableColumnId | null;
  setFilters: Dispatch<SetStateAction<StudyFilters>>;
};

export default function StudiesFilterRow({
  filters,
  highlightedColumnId,
  setFilters,
}: StudiesFilterRowProps) {
  return (
    <TableRow className="studies-resizable-row bg-card hover:bg-card !border-b-0 cursor-default">
      {studyTableColumns.map((column) => {
        const key = column.filterKey;

        return (
          <TableCell
            key={column.id}
            className={cn(
              'min-w-0',
              key && 'md:min-w-full',
              highlightedColumnId === column.id && 'studies-resizable-boundary-active'
            )}
          >
            {key ? (
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
            ) : null}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
