// src/components/Viewer/Measurement/MeasurementPanel.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { AnnotationMeasurement } from '@/hooks/useMeasurements';
import type { Series } from '@/lib/pacs/services';
import { cn, formatStudyDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { safeGetEnabledElement as safeGetEnabled } from '@/lib/cornerstone/helpers';

import EditLabelDialog from './EditLabelDialog';
import MeasurementStats from './MeasurementStats';
import PanelScrollArea from '@/components/Viewer/PanelScrollArea';

type MeasurementHeaderMode = 'circle' | 'length';

function CircleMeasurementIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M4.4 9.6 9.6 4.4M4.4 14.6 14.6 4.4M6.3 17.7 17.7 6.3M9.4 19.6 19.6 9.4M14.4 19.6 19.6 14.4"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function LengthMeasurementIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="m8.5 15.5 7-7" />
      <rect x="3.5" y="15.5" width="5" height="5" rx="0.75" />
      <rect x="15.5" y="3.5" width="5" height="5" rx="0.75" />
    </svg>
  );
}

interface MeasurementPanelProps {
  measurements: AnnotationMeasurement[];
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  onUpdateLabel: (annotationUID: string, newLabel: string) => void;
  onSelectMeasurement: (m: AnnotationMeasurement) => void;
  onRemoveMeasurement: (annotationUID: string) => void;
  seriesMap: Record<string, { files: string[]; metadata: Series }>;
  seriesInstanceUID?: string;
  refreshMeasurements?: () => void;
  currentFrame: number;
  totalFrames: number;
  viewportEl: HTMLDivElement | null;
  selectedMeasurementUID: string | null;
  studyDate: string;
  hiddenMeasurements: Set<string>;
  onToggleVisibility: (annotationUID: string) => void;
  mobileSidebarOpen?: boolean;
  onCloseMobile?: () => void;
  className?: string;
  onExportJSON?: () => void;
  onExportDICOMSR?: () => void;

  srList?: { id: string; label: string; count: number; instances?: any[] }[];
  activeSrId?: string | null;
  onSelectSr?: (srId: string | null) => void;
}

export default function MeasurementPanel({
  measurements,
  collapsed,
  setCollapsed,
  onUpdateLabel,
  onSelectMeasurement,
  onRemoveMeasurement,
  seriesMap,
  seriesInstanceUID,
  refreshMeasurements,
  currentFrame,
  totalFrames,
  viewportEl,
  selectedMeasurementUID,
  studyDate,
  hiddenMeasurements,
  onToggleVisibility,
  mobileSidebarOpen = false,
  onCloseMobile,
  className = '',
  onExportJSON,
  onExportDICOMSR,
  srList,
  activeSrId,
  onSelectSr,
}: MeasurementPanelProps) {
  const [editingLabel, setEditingLabel] = useState<{
    annotationUID: string;
    currentLabel: string;
  } | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [headerMode, setHeaderMode] = useState<MeasurementHeaderMode>('length');
  const formattedDate = formatStudyDate(studyDate);
  const [deletedUIDs, setDeletedUIDs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (measurements.length > 0) {
      setListCollapsed(false);
    }
  }, [measurements.length]);

  useEffect(() => {
    if (editingLabel) setNewLabel(editingLabel.currentLabel);
  }, [editingLabel]);

  useEffect(() => {
    setDeletedUIDs(new Set());
  }, [measurements.length]);

  const visible = measurements.filter((m) => !deletedUIDs.has(m.annotationUID));

  const isSelectedSR =
    typeof seriesInstanceUID === 'string' && seriesInstanceUID?.startsWith('SR_');

  let currentSrEntry: { id: string; label: string; count: number; instances?: any[] } | undefined;
  if (isSelectedSR && srList && srList.length) {
    const lookupId = activeSrId ?? seriesInstanceUID;
    currentSrEntry = srList.find((s) => s.id === lookupId) ?? srList.find((s) => s.id === seriesInstanceUID);
  }

  const isSR = (m: AnnotationMeasurement) => {
    const meta = seriesMap[m.metadata.seriesUID]?.metadata;
    return (
      Boolean(meta && meta.seriesModality === 'SR') ||
      String(m.metadata.seriesUID ?? '').startsWith('SR_')
    );
  };

  return (
    <aside
      className={cn(
        'bg-card text-foreground flex h-full min-h-0 min-w-0 flex-col overflow-hidden transition-[background-color,border-color] duration-200',
        mobileSidebarOpen ? 'absolute inset-y-0 right-0 w-2/3 z-50' : 'hidden md:flex',
        !mobileSidebarOpen && 'border-l border-border',
        className
      )}
    >
      {mobileSidebarOpen && onCloseMobile && (
        <Button
          variant="ghost"
          size="icon"
          className="self-start m-2 md:hidden"
          onClick={onCloseMobile}
          aria-label="Close measurement drawer"
        >
          <i className="fas fa-times" />
        </Button>
      )}

      <div
        className={cn(
          'relative flex h-[52px] min-h-[52px] items-center py-0',
          collapsed ? 'px-0' : 'border-b border-border px-2'
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          aria-expanded={!collapsed}
          className={cn(
            'hidden border border-border transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out active:scale-95 md:inline-flex',
            collapsed && 'mx-auto'
          )}
        >
          <i
            className={cn(
              'fas fa-chevron-right transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              collapsed && 'rotate-180'
            )}
          />
        </Button>

        {!collapsed && (
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="hidden items-center gap-1 md:flex" role="group" aria-label="Measurement modes">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Circle measurement mode"
                aria-pressed={headerMode === 'circle'}
                title="Circle measurement"
                onClick={() => setHeaderMode('circle')}
                className={cn(
                  'h-9 w-9 border border-border',
                  headerMode === 'circle'
                    ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                    : 'text-primary dark:text-white'
                )}
              >
                <CircleMeasurementIcon className="h-6 w-6" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Length measurement mode"
                aria-pressed={headerMode === 'length'}
                title="Length measurement"
                onClick={() => setHeaderMode('length')}
                className={cn(
                  'h-9 w-9 border border-border',
                  headerMode === 'length'
                    ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                    : 'text-primary dark:text-white'
                )}
              >
                <LengthMeasurementIcon className="h-6 w-6" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {collapsed && !mobileSidebarOpen && (
        <div
          aria-hidden="true"
          className="hidden flex-col items-center gap-3 pt-2 text-primary md:flex dark:text-white"
        >
          <CircleMeasurementIcon className="h-6 w-6" />
          <LengthMeasurementIcon className="h-6 w-6" />
        </div>
      )}

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-2">
            <div className="text-sm font-semibold truncate">{formattedDate}</div>
          </div>

          {isSelectedSR && (
            <div className="px-3 py-2 border-b bg-surface/60">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{currentSrEntry?.label ?? 'SR Series'}</div>
                  <div className="text-xs text-muted">{currentSrEntry ? `${currentSrEntry.count} annotation(s)` : 'SR loaded'}</div>
                </div>

                <div className="flex items-center space-x-2">
                  {onSelectSr && (
                    <button
                      type="button"
                      className="px-2 py-1 text-xs border rounded"
                      onClick={() => onSelectSr(currentSrEntry?.id ?? seriesInstanceUID)}
                    >
                      View SR
                    </button>
                  )}

                  {onSelectSr && (
                    <button
                      type="button"
                      className="px-2 py-1 text-xs border rounded"
                      onClick={() => onSelectSr(null)}
                      title="Close SR"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>

              {currentSrEntry?.instances && currentSrEntry.instances.length > 0 && (
                <div className="mt-2 text-xs">
                  <div className="font-medium">Instances:</div>
                  <ul className="list-disc pl-4">
                    {currentSrEntry.instances.slice(0, 5).map((it: any, idx: number) => (
                      <li key={idx} className="truncate">{String(it.sopInstanceUID ?? it.SOPInstanceUID ?? it.uid ?? `inst-${idx}`).slice(0, 40)}</li>
                    ))}
                    {currentSrEntry.instances.length > 5 && (
                      <li className="text-muted">... {currentSrEntry.instances.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h4 className="text-lg font-semibold">Measurement ({visible.length})</h4>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="p-1 border border-border"
                onClick={() => setListCollapsed((prev) => !prev)}
                aria-label={listCollapsed ? 'Expand list' : 'Collapse list'}
              >
                <i className={`fas fa-chevron-${listCollapsed ? 'down' : 'up'}`} />
              </Button>
            </div>
          </div>

          {!listCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-center px-4 py-2 border-b border-border">
                {(onExportJSON || onExportDICOMSR) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline">
                        Create SR <i className="fas fa-caret-down ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {onExportJSON && <DropdownMenuItem onClick={onExportJSON}>JSON SR</DropdownMenuItem>}
                      {onExportDICOMSR && <DropdownMenuItem onClick={onExportDICOMSR}>DICOM SR</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <PanelScrollArea contentClassName="min-h-full px-2 py-2 space-y-2">
                  {visible.length === 0 ? (
                    <div className="flex min-h-full flex-1 flex-col items-center justify-center text-center text-xs text-muted px-4 py-10 space-y-2">
                      <i className="fas fa-ruler text-3xl text-secondary-foreground" />
                      <div className="font-semibold text-base text-secondary-foreground">No Measurements</div>
                      <div className="text-secondary-foreground">Use annotation tools to add measurements.</div>
                    </div>
                  ) : (
                    (() => {
                      let srCounter = 0;
                      let nonSrCounter = 0;

                      return visible.map((item, idx) => {
                        const isSelected = item.annotationUID === selectedMeasurementUID;
                        const isHidden = hiddenMeasurements.has(item.annotationUID);
                        const labelText = item.label || 'Chưa có nhãn';
                        const isDefault = labelText === 'Chưa có nhãn';
                        const seriesUID = item.metadata.seriesUID;
                        const seriesMetadata = seriesMap[seriesUID]?.metadata;
                        const statTotalFrames = seriesMap[seriesUID]?.files.length ?? totalFrames;

                        const isSRItem =
                          Boolean(seriesMetadata && seriesMetadata.seriesModality === 'SR') ||
                          String(item.metadata.seriesUID ?? '').startsWith('SR_');

                        const displayIndex = isSRItem ? ++srCounter : ++nonSrCounter;

                        let insertSeparator = false;
                        if (idx > 0) {
                          const prev = visible[idx - 1];
                          const prevSeriesMeta = seriesMap[prev.metadata.seriesUID]?.metadata;
                          const prevIsSR =
                            Boolean(prevSeriesMeta && prevSeriesMeta.seriesModality === 'SR') ||
                            String(prev.metadata.seriesUID ?? '').startsWith('SR_');
                          if (prevIsSR !== isSRItem) insertSeparator = true;
                        }

                        return (
                          <React.Fragment key={item.annotationUID}>
                            {insertSeparator && (
                              <div className="flex items-center justify-center text-muted-foreground text-sm my-2">
                                <span className="flex-1 border-t border-border mr-2"></span>
                                — SR || Non-SR —
                                <span className="flex-1 border-t border-border ml-2"></span>
                              </div>
                            )}

                            <div
                              role="button"
                              tabIndex={0}
                              className={cn(
                                'w-full cursor-pointer rounded-md overflow-hidden transition-shadow duration-150',
                                isSelected ? 'bg-muted border-l-4 border-primary shadow-lg' : 'bg-card hover:bg-muted'
                              )}
                              onClick={() => onSelectMeasurement(item)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') onSelectMeasurement(item);
                              }}
                              aria-label={`Measurement ${isSRItem ? '(SR)' : ''} #${displayIndex}`}
                            >
                              <div className="p-3 flex items-start justify-between">
                                <div className="space-y-0.5">
                                  <div className="text-base text-foreground">#{displayIndex}</div>
                                  <div
                                    className={cn(
                                      'italic cursor-pointer hover:text-primary-foreground',
                                      isDefault ? 'text-muted-foreground' : 'text-foreground'
                                    )}
                                    onClick={() => {
                                      if (isSRItem) return;
                                      setEditingLabel({ annotationUID: item.annotationUID, currentLabel: labelText });
                                    }}
                                  >
                                    {labelText}
                                  </div>

                                  <MeasurementStats type={item.type} stats={item.data} />
                                </div>

                                <div className="flex flex-col items-end gap-1 text-xs text-secondary-foreground">
                                  {seriesMetadata && (
                                    <>
                                      <div>#{seriesMetadata.seriesNumber}</div>
                                      <div>
                                        I: {typeof item.metadata.frameIndex === 'number' ? item.metadata.frameIndex + 1 : '?'} / {statTotalFrames}
                                      </div>
                                    </>
                                  )}

                                  <div className="flex items-center gap-2 mt-1">
                                    <button
                                      type="button"
                                      className={cn(isSRItem ? 'opacity-50 cursor-not-allowed' : 'hover:text-foreground')}
                                      aria-label={
                                        isSRItem
                                          ? 'SR measurement — visibility locked'
                                          : isHidden
                                          ? 'Show measurement'
                                          : 'Hide measurement'
                                      }
                                      title={isSRItem ? 'SR measurement — visibility locked' : undefined}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isSRItem) return;
                                        onToggleVisibility(item.annotationUID);
                                      }}
                                      disabled={isSRItem}
                                      aria-disabled={isSRItem}
                                    >
                                      <i className={`fas fa-eye${isHidden ? '-slash' : ''}`} />
                                    </button>

                                    {/* DELETE BUTTON — simplified: optimistic hide + delegate removal to parent */}
                                    <button
                                      type="button"
                                      className={cn(isSRItem ? 'opacity-50 cursor-not-allowed' : 'hover:text-destructive')}
                                      aria-label={isSRItem ? 'Cannot delete SR measurement' : 'Delete'}
                                      title={isSRItem ? 'SR measurements are read-only' : 'Delete measurement'}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isSRItem) return;
                                        if (!viewportEl) return;

                                        // OPTIMISTIC UI: hide immediately for snappy UX
                                        setDeletedUIDs((prev) => {
                                          const next = new Set(prev);
                                          next.add(item.annotationUID);
                                          return next;
                                        });

                                        // Delegate actual removal to parent (centralized)
                                        try {
                                          onRemoveMeasurement(item.annotationUID);
                                        } catch (err) {
                                          // don't break UI
                                        }

                                        // Parent may update; optionally request refresh (best-effort)
                                        try {
                                          refreshMeasurements?.();
                                        } catch {
                                          // swallow
                                        }

                                        // light redraw of enabled viewport, if possible
                                        try {
                                          const enabled = safeGetEnabled(viewportEl) ?? null;
                                          enabled?.viewport?.render();
                                        } catch {
                                          // swallow
                                        }
                                      }}
                                      disabled={isSRItem}
                                      aria-disabled={isSRItem}
                                    >
                                      <i className="fas fa-trash" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      });
                    })()
                  )}
              </PanelScrollArea>
            </div>
          )}
        </div>
      )}

      {editingLabel && (
        <EditLabelDialog
          currentLabel={editingLabel.currentLabel}
          onCancel={() => setEditingLabel(null)}
          onSave={(label) => {
            onUpdateLabel(editingLabel.annotationUID, label);
            refreshMeasurements?.();
            setEditingLabel(null);
          }}
        />
      )}
    </aside>
  );
}
