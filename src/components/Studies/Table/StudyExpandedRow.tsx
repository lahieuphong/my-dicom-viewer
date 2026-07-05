import type { Study } from '@/lib/pacs/services';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { TableCell } from '@/components/ui/table';
import { normalizeValue } from '@/lib/utils';
import type { SeriesWithInstances } from './types';
import { getSeriesInstanceCount, truncateText } from './utils';

type StudyExpandedRowProps = {
  visible: boolean;
  uid: string;
  study: Study;
  seriesList: SeriesWithInstances[];
  seriesLoading: boolean;
  loading: boolean;
  expandTransition: unknown;
  shouldReduceMotion: boolean;
  onOpenViewer: (study: Study, uid: string) => void;
  onPrefetchStudy: (study: Study) => void;
};

export default function StudyExpandedRow({
  visible,
  uid,
  study,
  seriesList,
  seriesLoading,
  loading,
  expandTransition,
  shouldReduceMotion,
  onOpenViewer,
  onPrefetchStudy,
}: StudyExpandedRowProps) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.tr
          key={`expanded-${uid}`}
          className="border-b bg-popover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={expandTransition as any}
        >
          <TableCell colSpan={9} className="p-0 bg-popover overflow-hidden">
            <motion.div
              initial={{ height: 0, opacity: 0, y: -8 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -6 }}
              transition={expandTransition as any}
              className="overflow-hidden"
            >
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }
                }
                className="px-6 py-4"
              >
                <div className="grid grid-cols-4 gap-0 font-semibold text-sm border-b border-border pb-2">
                  <div className="px-4">Diễn giải</div>
                  <div className="px-4">Chuỗi</div>
                  <div className="px-4">Thiết bị</div>
                  <div className="px-4">Instances</div>
                </div>

                <div className="divide-y">
                  {seriesLoading && (
                    <div className="py-4 text-sm text-muted-foreground">Đang tải series...</div>
                  )}

                  {!seriesLoading && seriesList.length === 0 && (
                    <div className="py-4 text-sm text-muted">Không có series</div>
                  )}

                  {!seriesLoading && seriesList.map((series, seriesIndex) => (
                    <div
                      key={`series-${series.seriesInstanceUID || seriesIndex}`}
                      className="grid grid-cols-4 gap-0 items-start py-4"
                    >
                      <div className="px-4">
                        <div className="text-sm">
                          {truncateText(normalizeValue(series.seriesDescription))}
                        </div>
                      </div>

                      <div className="px-4">
                        <div className="text-sm">
                          {truncateText(normalizeValue(series.seriesNumber))}
                        </div>
                      </div>

                      <div className="px-4">
                        <div className="text-sm">
                          {truncateText(normalizeValue(series.seriesModality))}
                        </div>
                      </div>

                      <div className="px-4">
                        <div className="text-sm">
                          {truncateText(normalizeValue(String(getSeriesInstanceCount(series))))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4">
                  <Button
                    disabled={loading}
                    onClick={() => onOpenViewer(study, uid)}
                    onMouseEnter={() => onPrefetchStudy(study)}
                    className="bg-primary text-primary-foreground"
                  >
                    <i className="fas fa-arrow-right mr-2" />
                    Mở Viewer
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          </TableCell>
        </motion.tr>
      )}
    </AnimatePresence>
  );
}
