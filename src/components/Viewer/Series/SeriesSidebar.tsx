// src/components/Viewer/Series/SeriesSidebar.tsx
'use client';

import React, { useState } from 'react';
import { ChevronUp, Copy } from 'lucide-react';
import type { Series } from '@/lib/pacs/services';
import { Button } from '@/components/ui/button';
import { cn, formatStudyDate } from '@/lib/utils';
import PanelScrollArea from '@/components/Viewer/PanelScrollArea';

interface SeriesSidebarProps {
  seriesMap: Record<string, { files: any[]; metadata: Series | undefined }>;
  selectedSeries: string;
  onSelectSeries: (seriesUID: string) => void;
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  studyDate: string;
  studyDescription: string;
  mobileSidebarOpen?: boolean;
  onCloseMobile?: () => void;
  className?: string;

  loadedSrList?: {
    id: string;
    label: string;
    count: number;
    instances?: any[];
  }[];
  activeSrId?: string | null;
  onSelectSr?: (srId: string | null) => void;
  srGroups?: { id: number; srIds: string[]; label?: string }[];

  studyUID: string;
  viewportId?: string;
}

function truncateText(text?: string | null, max = 9) {
  if (!text) return '';
  const s = String(text);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function SRGroup({
  group,
  loadedSrList,
  activeSrId,
  onSelectSr,
}: {
  group: { id: number; srIds: string[]; label?: string };
  loadedSrList?: { id: string; label: string; count: number; instances?: any[] }[];
  activeSrId?: string | null;
  onSelectSr?: (id: string | null) => void;
}) {
  const [open, setOpen] = useState<boolean>(true);
  const label = group.label ?? `Group ${group.id}`;

  return (
    <div key={`grp-${group.id}`} className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-background hover:bg-muted text-sm font-semibold"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <i className="fas fa-layer-group" />
          <span className="flex-1 min-w-0 truncate" title={label}>
            {truncateText(label, 9)}
          </span>
        </div>
        <div className="text-xs opacity-70">{open ? '▾' : '▸'}</div>
      </button>

      {open && (
        <div className="pl-3 space-y-1">
          {group.srIds.map((srId) => {
            const srEntry = loadedSrList?.find((s) => s.id === srId);
            if (!srEntry) return null;
            const isActiveSr = srId === activeSrId;

            return (
              <button
                key={srId}
                onClick={() => onSelectSr?.(srId)}
                className={cn(
                  'flex flex-col w-full text-left px-3 py-2 rounded-md transition-shadow duration-150 overflow-hidden',
                  isActiveSr
                    ? 'bg-muted border-l-4 border-primary shadow-lg text-foreground'
                    : 'bg-background hover:bg-muted text-foreground'
                )}
              >
                <div className="text-sm font-sans mb-1 flex items-center gap-2">
                  <i className="fas fa-file-medical" />
                  <span className="flex-1 min-w-0 truncate" title={srEntry.label}>
                    {truncateText(srEntry.label, 9)}
                  </span>
                </div>
                <div className="flex items-center text-xs opacity-80 gap-4">
                  <span>{`${srEntry.count} item(s)`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SeriesSidebar({
  seriesMap,
  selectedSeries,
  onSelectSeries,
  collapsed,
  setCollapsed,
  studyDate,
  studyDescription,
  mobileSidebarOpen = false,
  onCloseMobile,
  className = '',
  loadedSrList,
  activeSrId,
  onSelectSr,
  srGroups,
}: SeriesSidebarProps) {
  const [listCollapsed, setListCollapsed] = useState(false);
  const formattedDate = formatStudyDate(studyDate);

  return (
    <aside
      className={cn(
        'relative bg-card text-foreground flex h-full min-h-0 min-w-0 flex-col overflow-hidden transition-[background-color,border-color] duration-200',
        mobileSidebarOpen ? 'absolute inset-y-0 left-0 w-2/3 z-50' : 'hidden md:flex',
        !mobileSidebarOpen && 'border-r border-border',
        className
      )}
    >
      {mobileSidebarOpen && onCloseMobile && (
        <Button
          variant="ghost"
          size="icon"
          className="self-end m-2 hover:bg-muted rounded"
          onClick={onCloseMobile}
          aria-label="Close sidebar"
        >
          <i className="fas fa-times" />
        </Button>
      )}

      <div
        className={cn(
          'relative flex h-[52px] min-h-[52px] items-center border-b px-2 py-0 transition-colors duration-200',
          collapsed ? 'border-transparent' : 'border-border'
        )}
      >
        {!collapsed && (
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 font-semibold text-lg select-none">
            Studies
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'viewer-panel-toggle viewer-panel-toggle-left absolute right-[5px] top-1/2 hidden h-9 w-9 shrink-0 -translate-y-1/2 transform-gpu border border-border transition-[background-color,border-color,box-shadow,transform] duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.04] active:scale-95 motion-reduce:transition-none md:inline-flex'
          )}
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <i
            className={cn(
              'fas fa-chevron-left w-3 transform-gpu text-center transition-transform duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              collapsed && 'rotate-180'
            )}
          />
        </Button>
      </div>

      {collapsed && !mobileSidebarOpen && (
        <div className="hidden justify-center pt-2 md:flex">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center text-primary dark:text-white"
          >
            <Copy className="h-6 w-6 stroke-[2.25]" />
          </div>
        </div>
      )}

      {!collapsed && (
        <>
          <div className="h-[52px] min-h-[52px] pl-4 pr-[5px] py-0 border-b border-border flex items-center justify-between gap-3">
            <div className="flex flex-col justify-center min-w-0">
              <div className="text-sm font-semibold truncate" title={formattedDate}>
                {formattedDate}
              </div>
              <div className="text-xs opacity-80">
                <span className="flex-1 min-w-0 truncate block" title={studyDescription}>
                  {truncateText(studyDescription, 9)}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 transform-gpu border border-border transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.04] active:scale-95 motion-reduce:transition-none"
              onClick={() => setListCollapsed((prev) => !prev)}
              aria-label={listCollapsed ? 'Open list' : 'Close list'}
              aria-expanded={!listCollapsed}
            >
              <ChevronUp
                aria-hidden="true"
                className={cn(
                  'size-5 shrink-0 transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                  listCollapsed && 'rotate-180'
                )}
                strokeWidth={2.5}
              />
            </Button>
          </div>

          <div
            className="viewer-panel-collapsible"
            data-collapsed={listCollapsed}
            aria-hidden={listCollapsed}
          >
            <div className="viewer-panel-collapsible-content">
              <PanelScrollArea
                scrollbarVisibility="always"
                contentClassName="min-h-full px-2 py-2 space-y-2"
              >
                <div>
                  {Object.entries(seriesMap).map(([uid, data]) => {
                    if (!data || !data.metadata) return null;
                    const metadata = data.metadata;
                    const isSelected = uid === selectedSeries && activeSrId == null;

                    return (
                      <button
                        key={uid}
                        onClick={() => {
                          onSelectSr?.(null);
                          onSelectSeries(uid);
                        }}
                        className={cn(
                          'flex flex-col w-full text-left px-3 py-2 rounded-md transition-shadow duration-150 overflow-hidden',
                          isSelected
                            ? 'bg-muted border-l-4 border-primary shadow-lg text-foreground'
                            : 'bg-background hover:bg-muted text-foreground'
                        )}
                      >
                        <div className="text-sm font-sans mb-1 flex items-center gap-2">
                          <span
                            className="flex-1 min-w-0 truncate"
                            title={`${metadata.seriesModality} ${metadata.seriesDescription || 'Unnamed Series'}`}
                          >
                            {truncateText(`${metadata.seriesModality} ${metadata.seriesDescription || 'Unnamed Series'}`, 9)}
                          </span>
                        </div>
                        <div className="flex items-center text-xs opacity-80 gap-4">
                          <span>#{metadata.seriesNumber}</span>
                          <span>{metadata.seriesRelatedInstanceCount} item(s)</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <hr className="my-2" />

                {srGroups && srGroups.length > 0 ? (
                  srGroups.map((group) => (
                    <SRGroup
                      key={`group-${group.id}`}
                      group={group}
                      loadedSrList={loadedSrList}
                      activeSrId={activeSrId}
                      onSelectSr={onSelectSr}
                    />
                  ))
                ) : (
                  loadedSrList?.map((sr) => {
                    const isActiveSr = sr.id === activeSrId;

                    return (
                      <button
                        key={sr.id}
                        onClick={() => {
                          onSelectSr?.(sr.id);
                        }}
                        className={cn(
                          'flex flex-col w-full text-left px-3 py-2 rounded-md transition-shadow duration-150 overflow-hidden',
                          isActiveSr
                            ? 'bg-muted border-l-4 border-primary shadow-lg text-foreground'
                            : 'bg-background hover:bg-muted text-foreground'
                        )}
                      >
                        <div className="text-sm font-sans mb-1 flex items-center gap-2">
                          <i className="fas fa-file-medical" />
                          <span className="flex-1 min-w-0 truncate" title={sr.label}>
                            {truncateText(sr.label, 9)}
                          </span>
                        </div>
                        <div className="flex items-center text-xs opacity-80 gap-4">
                          <span>{`${sr.count} item(s)`}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </PanelScrollArea>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
