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
        className="flex h-[min(90vh,56rem)] w-[calc(100vw-1.5rem)] max-w-[96rem] flex-col gap-0 overflow-hidden border-primary/30 bg-background p-0 shadow-2xl sm:max-w-[96rem]"
      >
        <DialogHeader className="shrink-0 border-b border-border bg-card/90 px-6 py-5 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <Database className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-xl text-primary">
                DICOM Tag Browser
              </DialogTitle>
              <DialogDescription className="mt-1">
                Xem metadata gốc của từng series và instance DICOM.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid shrink-0 gap-4 border-b border-border bg-muted/20 px-6 py-4 lg:grid-cols-[minmax(260px,1.15fr)_minmax(260px,0.9fr)_minmax(260px,1fr)]">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="dicom-tag-series-select">
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
                className="h-11 bg-background"
                aria-label="Chọn DICOM series"
              >
                <SelectValue placeholder="Không có series" />
              </SelectTrigger>
              <SelectContent className="z-[110] max-w-[min(90vw,36rem)]">
                {browser.series.map((series) => (
                  <SelectItem key={series.uid} value={series.uid}>
                    <span className="block max-w-[32rem] truncate">
                      {series.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm font-medium">
              <label htmlFor="dicom-tag-instance-slider">Instance Number</label>
              <span className="text-xs font-semibold tabular-nums text-primary">
                {browser.instanceCount > 0 ? browser.instanceIndex + 1 : 0} of{' '}
                {browser.instanceCount}
              </span>
            </div>
            <div className="flex h-11 items-center rounded-md border border-input bg-background px-3 shadow-xs">
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

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="dicom-tag-search">
              Search metadata
            </label>
            <div className="relative">
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
                className="h-11 bg-background pl-10"
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
              className="flex h-full min-h-60 flex-col items-center justify-center gap-4 px-6 text-center"
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

        <div className="flex min-h-11 shrink-0 items-center justify-between gap-4 border-t border-border bg-card/80 px-6 py-2 text-xs text-muted-foreground">
          <span>
            {browser.tree
              ? `${browser.tree.elementCount.toLocaleString()} phần tử metadata`
              : 'Metadata chỉ được đọc, không thay đổi ảnh DICOM.'}
          </span>
          {browser.tree?.nodesTruncated && browser.tree.valuesTruncated ? (
            <span className="font-medium text-amber-500">
              Cây metadata và một số value quá lớn nên đã được giới hạn.
            </span>
          ) : browser.tree?.nodesTruncated ? (
            <span className="font-medium text-amber-500">
              Cây metadata quá lớn nên một số hàng đã được giới hạn.
            </span>
          ) : browser.tree?.valuesTruncated ? (
            <span className="font-medium text-amber-500">
              Một số value quá lớn nên đã được rút gọn an toàn.
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
