import type { Study } from '@/lib/pacs/services';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn, fieldToString, formatStudyDate, normalizeValue } from '@/lib/utils';
import InstanceCountIcon from './InstanceCountIcon';
import type { StudyTableColumnId } from './columns';
import { truncateText } from './utils';

type StudyDataRowProps = {
  study: Study;
  index: number;
  highlightedColumnId: StudyTableColumnId | null;
  totalInstances: number;
  onToggle: () => void;
};

export default function StudyDataRow({
  study,
  index,
  highlightedColumnId,
  totalInstances,
  onToggle,
}: StudyDataRowProps) {
  const boundaryClass = (columnId: StudyTableColumnId) =>
    highlightedColumnId === columnId ? 'studies-resizable-boundary-active' : undefined;

  return (
    <TableRow onClick={onToggle} className="studies-resizable-row studies-resizable-data-row cursor-pointer bg-background hover:bg-muted">
      <TableCell className={cn('text-center', boundaryClass('index'))}>{index + 1}</TableCell>

      <TableCell className={cn('truncate', boundaryClass('patientName'))}>
        {truncateText(normalizeValue(study.patientName))}
      </TableCell>

      <TableCell className={cn('truncate', boundaryClass('patientId'))}>
        {truncateText(normalizeValue(study.patientId))}
      </TableCell>

      <TableCell className={cn('truncate', boundaryClass('studyDate'))}>
        {truncateText(formatStudyDate(fieldToString(study.studyDate)))}
      </TableCell>

      <TableCell className={cn('truncate', boundaryClass('studyDescription'))}>
        {truncateText(normalizeValue(study.studyDescription))}
      </TableCell>

      <TableCell className={cn('truncate', boundaryClass('modalitiesInStudy'))}>
        {truncateText(normalizeValue(study.modalitiesInStudy))}
      </TableCell>

      <TableCell className={cn('truncate', boundaryClass('studyInstanceUID'))}>
        {truncateText(normalizeValue(study.studyInstanceUID))}
      </TableCell>

      <TableCell className={cn('truncate', boundaryClass('accessionNumber'))}>
        {truncateText(normalizeValue(study.accessionNumber))}
      </TableCell>

      <TableCell className={cn('text-center', boundaryClass('instanceCount'))}>
        <span className="inline-flex items-center justify-center gap-2 tabular-nums">
          <InstanceCountIcon />
          <span>{truncateText(String(totalInstances || ''))}</span>
        </span>
      </TableCell>
    </TableRow>
  );
}
