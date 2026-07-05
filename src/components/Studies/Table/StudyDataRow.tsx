import type { Study } from '@/lib/pacs/services';
import { TableCell, TableRow } from '@/components/ui/table';
import { fieldToString, formatStudyDate, normalizeValue } from '@/lib/utils';
import InstanceCountIcon from './InstanceCountIcon';
import { truncateText } from './utils';

type StudyDataRowProps = {
  study: Study;
  index: number;
  totalInstances: number;
  onToggle: () => void;
};

export default function StudyDataRow({
  study,
  index,
  totalInstances,
  onToggle,
}: StudyDataRowProps) {
  return (
    <TableRow onClick={onToggle} className="cursor-pointer bg-background hover:bg-muted">
      <TableCell className="text-center">{index + 1}</TableCell>

      <TableCell className="truncate">
        {truncateText(normalizeValue(study.patientName))}
      </TableCell>

      <TableCell className="truncate">
        {truncateText(normalizeValue(study.patientId))}
      </TableCell>

      <TableCell className="truncate">
        {truncateText(formatStudyDate(fieldToString(study.studyDate)))}
      </TableCell>

      <TableCell className="truncate">
        {truncateText(normalizeValue(study.studyDescription))}
      </TableCell>

      <TableCell className="truncate">
        {truncateText(normalizeValue(study.modalitiesInStudy))}
      </TableCell>

      <TableCell className="truncate">
        {truncateText(normalizeValue(study.studyInstanceUID))}
      </TableCell>

      <TableCell className="truncate">
        {truncateText(normalizeValue(study.accessionNumber))}
      </TableCell>

      <TableCell className="text-center">
        <span className="inline-flex items-center justify-center gap-2 tabular-nums">
          <InstanceCountIcon />
          <span>{truncateText(String(totalInstances || ''))}</span>
        </span>
      </TableCell>
    </TableRow>
  );
}
