'use client';

import { useEffect, useState } from 'react';
import { Database, LoaderCircle, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DicomTagNode } from '@/lib/dicom-tags';

import DicomTagTreeTable from './DicomTagTreeTable';
import {
  useDicomTagBrowser,
  type DicomTagBrowserSeriesMap,
} from './useDicomTagBrowser';

type DicomTagBrowserDialogProps = {
  open: boolean;
  seriesMap: DicomTagBrowserSeriesMap;
  activeSeriesUID: string;
  onClose: () => void;
};

const AUTO_EXPAND_ELEMENT_LIMIT = 1_500;

function collectExpandableNodeIds(
  nodes: readonly DicomTagNode[],
  ids = new Set<string>()
): Set<string> {
  for (const node of nodes) {
    if (node.children.length === 0) continue;
    ids.add(node.id);
    collectExpandableNodeIds(node.children, ids);
  }
  return ids;
}

export default function DicomTagBrowserDialog({
  open,
  seriesMap,
  activeSeriesUID,
  onClose,
}: DicomTagBrowserDialogProps) {
  const browser = useDicomTagBrowser({
    open,
    seriesMap,
    activeSeriesUID,
  });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSearch('');
    setDebouncedSearch('');
    setExpanded(new Set());
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setExpanded(new Set());
  }, [browser.selectedSeriesUID, browser.instanceIndex]);

  useEffect(() => {
    if (!browser.tree) return;
    // OHIF opens SQ/item rows by default; users can collapse each branch.
    // Very large Enhanced DICOM trees stay collapsed initially and are
    // rendered in batches so opening the browser cannot lock the viewer.
    setExpanded(
      browser.tree.elementCount <= AUTO_EXPAND_ELEMENT_LIMIT
        ? collectExpandableNodeIds(browser.tree.nodes)
        : new Set()
    );
  }, [browser.tree]);

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        data-testid="dicom-tag-browser-dialog"
        className="flex h-[min(92dvh,48rem)] w-[calc(100dvw-1rem)] max-w-[80rem] flex-col gap-0 overflow-hidden border-primary/30 bg-background p-0 shadow-2xl sm:h-[min(88dvh,48rem)] sm:w-[calc(100dvw-2rem)] sm:max-w-[80rem] lg:h-[min(82dvh,48rem)] lg:w-[min(88dvw,80rem)] [@media(max-height:600px)]:h-[calc(100dvh-0.75rem)]"
      >
        <DialogHeader className="shrink-0 border-b border-border bg-card/90 px-4 py-4 pr-12 sm:px-5 sm:pr-14 lg:px-6 [@media(max-height:600px)]:py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary sm:size-10">
              <Database className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg text-primary sm:text-xl">
                DICOM Tag Browser
              </DialogTitle>
              <DialogDescription
                className="mt-0.5 truncate text-xs sm:mt-1 sm:text-sm [@media(max-height:600px)]:hidden"
                title="Xem metadata gốc của từng series và instance DICOM."
              >
                Xem metadata gốc của từng series và instance DICOM.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid max-h-[42dvh] shrink-0 grid-cols-1 gap-3 overflow-y-auto border-b border-border bg-muted/20 px-4 py-3 min-[34rem]:grid-cols-3 sm:px-5 lg:max-h-none lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-4 lg:overflow-visible lg:px-6 lg:py-4 [@media(max-height:600px)]:max-h-[36dvh] [@media(max-height:600px)]:gap-2 [@media(max-height:600px)]:py-2">
          <div className="grid min-w-0 grid-rows-[1.25rem_2.5rem] gap-1.5 sm:grid-rows-[1.25rem_2.75rem] lg:gap-2 [@media(max-height:600px)]:grid-rows-[1.25rem_2.5rem] [@media(max-height:600px)]:gap-1">
            <label
              className="flex h-5 min-w-0 items-center truncate text-sm font-medium leading-none"
              htmlFor="dicom-tag-series-select"
            >
              Series
            </label>
            <Select
              value={browser.selectedSeriesUID}
              onValueChange={browser.selectSeries}
              disabled={browser.series.length === 0}
            >
              <SelectTrigger
                id="dicom-tag-series-select"
                data-testid="dicom-tag-series-select"
                className="h-full min-h-0 min-w-0 bg-background [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:text-left"
                aria-label="Chọn DICOM series"
              >
                <SelectValue className="min-w-0 flex-1 truncate text-left" placeholder="Không có series" />
              </SelectTrigger>
              <SelectContent className="z-[110] max-w-[calc(100vw-2rem)] sm:max-w-[min(90vw,36rem)]">
                {browser.series.map((series) => (
                  <SelectItem key={series.uid} value={series.uid}>
                    <span
                      className="block max-w-[calc(100dvw-6rem)] truncate sm:max-w-[32rem]"
                      title={series.label}
                    >
                      {series.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid min-w-0 grid-rows-[1.25rem_2.5rem] gap-1.5 sm:grid-rows-[1.25rem_2.75rem] lg:gap-2 [@media(max-height:600px)]:grid-rows-[1.25rem_2.5rem] [@media(max-height:600px)]:gap-1">
            <div className="flex h-5 min-w-0 items-center justify-between gap-3 text-sm font-medium leading-none">
              <label className="min-w-0 truncate leading-none" htmlFor="dicom-tag-instance-slider">
                Instance Number
              </label>
              <span className="shrink-0 text-xs font-semibold leading-none tabular-nums text-primary">
                {browser.instanceCount > 0 ? browser.instanceIndex + 1 : 0} of{' '}
                {browser.instanceCount}
              </span>
            </div>
            <div className="flex h-full min-h-0 items-center rounded-md border border-input bg-background px-3 shadow-xs">
              <input
                id="dicom-tag-instance-slider"
                type="range"
                min={1}
                max={Math.max(1, browser.instanceCount)}
                step={1}
                value={browser.instanceCount > 0 ? browser.instanceIndex + 1 : 1}
                disabled={browser.instanceCount <= 1}
                aria-label="Instance Number"
                aria-valuetext={`${
                  browser.instanceCount > 0 ? browser.instanceIndex + 1 : 0
                } trên ${browser.instanceCount}`}
                data-testid="dicom-tag-instance-slider"
                className="h-2 w-full cursor-pointer accent-primary disabled:cursor-default disabled:opacity-45"
                onChange={(event) =>
                  browser.selectInstance(Number(event.currentTarget.value) - 1)
                }
              />
            </div>
          </div>

          <div className="grid min-w-0 grid-rows-[1.25rem_2.5rem] gap-1.5 sm:grid-rows-[1.25rem_2.75rem] lg:gap-2 [@media(max-height:600px)]:grid-rows-[1.25rem_2.5rem] [@media(max-height:600px)]:gap-1">
            <label
              className="flex h-5 min-w-0 items-center truncate text-sm font-medium leading-none"
              htmlFor="dicom-tag-search"
            >
              Search metadata
            </label>
            <div className="relative h-full min-h-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="dicom-tag-search"
                type="search"
                value={search}
                autoComplete="off"
                placeholder="Tag, VR, keyword hoặc value"
                aria-label="Search metadata"
                data-testid="dicom-tag-search"
                className="h-full min-h-0 min-w-0 bg-background pl-10 text-ellipsis"
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-background">
          {browser.loading && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/85 text-sm text-muted-foreground backdrop-blur-[1px]"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle className="size-7 animate-spin text-primary" aria-hidden="true" />
              Đang đọc metadata DICOM…
            </div>
          )}

          {!browser.loading && browser.error && (
            <div
              className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-6 text-center"
              role="alert"
            >
              <div>
                <p className="font-semibold">Không thể hiển thị DICOM tags</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {browser.error}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={browser.retry}>
                Thử lại
              </Button>
            </div>
          )}

          {!browser.loading && !browser.error && browser.tree && (
            <div className="h-full overflow-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
              <DicomTagTreeTable
                nodes={browser.tree.nodes}
                search={debouncedSearch}
                expanded={expanded}
                onToggle={toggleExpanded}
              />
            </div>
          )}
        </div>

        <div className="flex min-h-11 min-w-0 shrink-0 flex-col items-start justify-center gap-1 border-t border-border bg-card/80 px-4 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 lg:px-6 [@media(max-height:600px)]:min-h-9 [@media(max-height:600px)]:flex-row [@media(max-height:600px)]:items-center [@media(max-height:600px)]:justify-between [@media(max-height:600px)]:gap-2 [@media(max-height:600px)]:py-1">
          <span
            className="min-w-0 max-w-full truncate"
            title={
              browser.tree
                ? `${browser.tree.elementCount.toLocaleString()} phần tử metadata`
                : 'Metadata chỉ được đọc, không thay đổi ảnh DICOM.'
            }
          >
            {browser.tree
              ? `${browser.tree.elementCount.toLocaleString()} phần tử metadata`
              : 'Metadata chỉ được đọc, không thay đổi ảnh DICOM.'}
          </span>
          {browser.tree?.nodesTruncated && browser.tree.valuesTruncated ? (
            <span
              className="min-w-0 max-w-full truncate text-right font-medium text-amber-500"
              title="Cây metadata và một số value quá lớn nên đã được giới hạn."
            >
              Cây metadata và một số value quá lớn nên đã được giới hạn.
            </span>
          ) : browser.tree?.nodesTruncated ? (
            <span
              className="min-w-0 max-w-full truncate text-right font-medium text-amber-500"
              title="Cây metadata quá lớn nên một số hàng đã được giới hạn."
            >
              Cây metadata quá lớn nên một số hàng đã được giới hạn.
            </span>
          ) : browser.tree?.valuesTruncated ? (
            <span
              className="min-w-0 max-w-full truncate text-right font-medium text-amber-500"
              title="Một số value quá lớn nên đã được rút gọn an toàn."
            >
              Một số value quá lớn nên đã được rút gọn an toàn.
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
