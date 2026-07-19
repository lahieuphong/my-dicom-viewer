'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import BackgroundSeriesSelect from './BackgroundSeriesSelect';
import { buildViewportSeriesOptions } from './seriesOptions';
import type { ViewportSeriesMap } from './types';

type ViewportDataOverlayMenuProps = {
  seriesMap?: ViewportSeriesMap;
  selectedSeriesUID?: string;
  onSelectSeries?: (seriesUID: string) => void;
};

function ViewportViewsIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12.1675 14.7545C12.0607 14.8152 11.9393 14.8152 11.8325 14.7545L3.25173 9.89965C3.09887 9.81314 3 9.6169 3 9.4C3 9.1831 3.09887 8.98686 3.25173 8.90035L11.8325 4.04549C11.9393 3.98484 12.0607 3.98484 12.1675 4.04549L20.7483 8.90035C20.9011 8.98686 21 9.1831 21 9.4C21 9.6169 20.9011 9.81314 20.7483 9.89965L12.1675 14.7545Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.7793 12.1L20.7483 14.3367C20.9011 14.4227 21 14.6178 21 14.8333C21 15.0489 20.9011 15.2439 20.7483 15.3299L12.1675 20.1548C12.0607 20.2151 11.9393 20.2151 11.8325 20.1548L3.25173 15.3299C3.09887 15.2439 3 15.0489 3 14.8333C3 14.6178 3.09887 14.4227 3.25173 14.3367L7.20181 12.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ViewportDataOverlayMenu({
  seriesMap,
  selectedSeriesUID = '',
  onSelectSeries,
}: ViewportDataOverlayMenuProps) {
  const options = useMemo(() => buildViewportSeriesOptions(seriesMap), [seriesMap]);
  const canSelectSeries = options.length > 0 && typeof onSelectSeries === 'function';
  const [panelOpen, setPanelOpen] = useState(false);
  const [backgroundSelectOpen, setBackgroundSelectOpen] = useState(false);

  if (!canSelectSeries) {
    return <ViewportViewsIcon className="size-5 shrink-0" />;
  }

  return (
    <Popover
      open={panelOpen}
      onOpenChange={(open) => {
        setPanelOpen(open);
        if (!open) setBackgroundSelectOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="viewport-data-overlay-trigger"
          className="pointer-events-auto inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-[#348cfd] transition-colors hover:bg-[#348cfd]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#348cfd]/70 data-[state=open]:bg-[#348cfd]/15"
          aria-label="Cấu hình lớp hiển thị"
          title="Cấu hình lớp hiển thị"
        >
          <ViewportViewsIcon className="size-5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        data-testid="viewport-data-overlay-panel"
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={8}
        className="pointer-events-auto w-[min(17.25rem,calc(100vw-1rem))] rounded-xl border-primary/30 bg-popover p-3 text-popover-foreground shadow-2xl"
        aria-label="Cấu hình lớp dữ liệu hiển thị"
        onEscapeKeyDown={(event) => {
          if (backgroundSelectOpen) {
            event.preventDefault();
            setBackgroundSelectOpen(false);
          }
        }}
      >
        <h2 className="sr-only">Cấu hình lớp dữ liệu hiển thị</h2>

        {/* Foreground and segmentation controls can be added above this row later. */}
        <BackgroundSeriesSelect
          options={options}
          value={selectedSeriesUID}
          open={backgroundSelectOpen}
          onOpenChange={setBackgroundSelectOpen}
          onValueChange={(seriesUID) => onSelectSeries?.(seriesUID)}
        />
      </PopoverContent>
    </Popover>
  );
}
