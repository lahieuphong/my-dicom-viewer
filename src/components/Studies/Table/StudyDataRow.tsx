import type { Study } from '@/platform/core';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn, fieldToString, formatStudyDate, normalizeValue } from '@/lib/utils';
import InstanceCountIcon from './InstanceCountIcon';
import type { StudyTableColumnId } from './columns';

type StudyDataRowProps = {
  study: Study;
  index: number;
  highlightedColumnId: StudyTableColumnId | null;
  totalInstances: number;
  onToggle: () => void;
};

function TruncatedCellText({ value }: { value: string }) {
  return (
    <span className="block max-w-full truncate" title={value}>
      {value}
    </span>
  );
}

export default function StudyDataRow({
  study,
  index,
  highlightedColumnId,
  totalInstances,
  onToggle,
}: StudyDataRowProps) {
  const boundaryClass = (columnId: StudyTableColumnId) =>
    highlightedColumnId === columnId ? 'studies-resizable-boundary-active' : undefined;
  const patientName = normalizeValue(study.patientName);
  const patientId = normalizeValue(study.patientId);
  const studyDate = formatStudyDate(fieldToString(study.studyDate));
  const studyDescription = normalizeValue(study.studyDescription);
  const modality = normalizeValue(study.modalitiesInStudy);
  const studyInstanceUID = normalizeValue(study.studyInstanceUID);
  const accessionNumber = normalizeValue(study.accessionNumber);
  const instanceCount = String(totalInstances || '');

  return (
    <TableRow onClick={onToggle} className="studies-resizable-row studies-resizable-data-row cursor-pointer bg-background hover:bg-muted">
      <TableCell className={cn('text-center', boundaryClass('index'))}>{index + 1}</TableCell>

      <TableCell className={cn('min-w-0', boundaryClass('patientName'))}>
        <TruncatedCellText value={patientName} />
      </TableCell>

      <TableCell className={cn('min-w-0', boundaryClass('patientId'))}>
        <TruncatedCellText value={patientId} />
      </TableCell>

      <TableCell className={cn('min-w-0', boundaryClass('studyDate'))}>
        <TruncatedCellText value={studyDate} />
      </TableCell>

      <TableCell className={cn('min-w-0', boundaryClass('studyDescription'))}>
        <TruncatedCellText value={studyDescription} />
      </TableCell>

      <TableCell className={cn('min-w-0', boundaryClass('modalitiesInStudy'))}>
        <TruncatedCellText value={modality} />
      </TableCell>

      <TableCell className={cn('min-w-0', boundaryClass('studyInstanceUID'))}>
        <TruncatedCellText value={studyInstanceUID} />
      </TableCell>

      <TableCell className={cn('min-w-0', boundaryClass('accessionNumber'))}>
        <TruncatedCellText value={accessionNumber} />
      </TableCell>

      <TableCell className={cn('text-center', boundaryClass('instanceCount'))}>
        <span className="inline-flex items-center justify-center gap-2 tabular-nums">
          <InstanceCountIcon />
          <span>{instanceCount}</span>
        </span>
      </TableCell>
    </TableRow>
  );
}
