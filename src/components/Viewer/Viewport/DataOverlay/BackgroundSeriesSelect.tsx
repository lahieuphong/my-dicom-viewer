'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ViewportSeriesOption } from './types';

type BackgroundSeriesSelectProps = {
  options: readonly ViewportSeriesOption[];
  value?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onValueChange: (seriesUID: string) => void;
};

function BackgroundLayerIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="4.25"
        y="4.25"
        width="14.5"
        height="14.5"
        rx="2.75"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="9" y="9" width="15" height="15" rx="3" fill="currentColor" opacity="0.65" />
    </svg>
  );
}

function getOptionLabel(option: ViewportSeriesOption): string {
  return `Series ${option.seriesNumber} - ${option.description || option.modality}`;
}

export default function BackgroundSeriesSelect({
  options,
  value = '',
  open,
  onOpenChange,
  onValueChange,
}: BackgroundSeriesSelectProps) {
  const selectedOption = options.find((option) => option.uid === value);
  const selectedValue = selectedOption?.uid ?? '';

  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2">
      <BackgroundLayerIcon className="size-7 text-[#84c8e8]" />

      <Select
        value={selectedValue}
        open={open}
        onOpenChange={onOpenChange}
        onValueChange={(seriesUID) => {
          if (seriesUID && seriesUID !== value) {
            onValueChange(seriesUID);
          }
        }}
      >
        <SelectTrigger
          data-testid="viewport-background-series-trigger"
          aria-label="Chọn series nền"
          className="h-11 min-w-0 border-primary/45 bg-primary/5 px-3 text-popover-foreground shadow-none hover:bg-primary/10 focus-visible:border-primary/70 focus-visible:ring-primary/25 data-[state=open]:border-primary/70 data-[state=open]:bg-primary/10"
        >
          <SelectValue placeholder="Chọn series nền">
            {selectedOption ? (
              <span
                className="block min-w-0 truncate text-left text-sm font-semibold uppercase"
                title={`Series ${selectedOption.seriesNumber} - ${selectedOption.modality}`}
              >
                Series {selectedOption.seriesNumber} - {selectedOption.modality}
              </span>
            ) : null}
          </SelectValue>
        </SelectTrigger>

        <SelectContent
          data-testid="viewport-background-series-options"
          position="popper"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          className="z-[70] max-h-[min(24rem,70vh)] w-[min(26rem,calc(100vw-1rem))] overscroll-contain border-primary/35 bg-popover p-0 text-popover-foreground shadow-2xl"
        >
          <SelectGroup>
            {options.map((option) => {
              const label = getOptionLabel(option);

              return (
                <SelectItem
                  key={option.uid}
                  value={option.uid}
                  textValue={`${label} ${option.modality}`}
                  className="min-h-11 rounded-none py-2.5 focus:bg-primary/10"
                  aria-label={`${label}, ${option.modality}, ${option.instanceCount} ảnh`}
                >
                  <span className="flex min-w-0 w-full items-center gap-4">
                    <span className="min-w-0 flex-1 truncate font-medium" title={label}>
                      {label}
                    </span>
                    <span className="ml-auto shrink-0 text-xs font-semibold text-[#84c8e8]">
                      {option.modality}
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
