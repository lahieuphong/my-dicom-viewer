'use client';

import { Grid2x2, List } from 'lucide-react';

import { cn } from '@/lib/utils';

export type SeriesViewMode = 'list' | 'image';

type SeriesViewToggleProps = {
  value: SeriesViewMode;
  onValueChange: (value: SeriesViewMode) => void;
};

const viewOptions: Array<{
  value: SeriesViewMode;
  label: string;
  Icon: typeof List;
}> = [
  { value: 'list', label: 'List view', Icon: List },
  { value: 'image', label: 'Image view', Icon: Grid2x2 },
];

export default function SeriesViewToggle({
  value,
  onValueChange,
}: SeriesViewToggleProps) {
  return (
    <div
      className="inline-flex h-10 items-center rounded-md border border-border bg-background p-1 shadow-sm"
      role="group"
      aria-label="Series view"
    >
      {viewOptions.map(({ value: optionValue, label, Icon }) => {
        const active = value === optionValue;

        return (
          <button
            key={optionValue}
            type="button"
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-[4px] text-muted-foreground transition-[background-color,color,box-shadow,transform] duration-200 ease-out hover:bg-muted hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              active &&
                'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground'
            )}
            onClick={() => onValueChange(optionValue)}
            aria-label={label}
            aria-pressed={active}
            title={label}
          >
            <Icon aria-hidden="true" className="size-5" strokeWidth={2.1} />
          </button>
        );
      })}
    </div>
  );
}
