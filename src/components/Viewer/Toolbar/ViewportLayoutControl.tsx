'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import ViewportLayoutIcon from '@/components/Viewer/ViewportLayout/ViewportLayoutIcon';
import ViewportLayoutPicker from '@/components/Viewer/ViewportLayout/ViewportLayoutPicker';
import {
  getViewportCount,
  type ViewportGridLayout,
} from '@/components/Viewer/ViewportLayout/viewportLayout';

import ToolbarTooltip from './ToolbarTooltip';

type ViewportLayoutControlProps = {
  layout: ViewportGridLayout;
  onApply: (layout: ViewportGridLayout) => void;
  onActivate?: () => void;
  disabled?: boolean;
};

/** Header control for selecting the viewport grid, placed beside Camera. */
export default function ViewportLayoutControl({
  layout,
  onApply,
  onActivate,
  disabled = false,
}: ViewportLayoutControlProps) {
  const [open, setOpen] = useState(false);
  const hasSplitLayout = getViewportCount(layout) > 1;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open) onActivate?.();
    setOpen(nextOpen);
  };

  const handleApply = (nextLayout: ViewportGridLayout) => {
    onApply(nextLayout);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <ToolbarTooltip
        label="Thay đổi bố cục"
        detail={`Bố cục hiện tại: ${layout.rows} × ${layout.columns}`}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={open || hasSplitLayout ? 'default' : 'ghost'}
            disabled={disabled}
            className="relative h-8 w-8 shrink-0 rounded-md border border-border p-0 sm:h-9 sm:w-9"
            aria-label={`Thay đổi bố cục — Bố cục hiện tại ${layout.rows} × ${layout.columns}`}
            aria-haspopup="dialog"
            data-testid="viewport-layout-trigger"
            data-layout={`${layout.rows}x${layout.columns}`}
          >
            <ViewportLayoutIcon
              className="size-[22px]"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
      </ToolbarTooltip>

      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={8}
        collisionPadding={8}
        data-testid="viewport-layout-popover"
        className="z-[95] w-[min(31rem,calc(100dvw-1rem))] overflow-hidden rounded-xl border-primary/35 bg-card p-0 text-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              Thay đổi bố cục
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Chọn bố cục viewport
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">
            {getViewportCount(layout)} cửa sổ
          </span>
        </div>

        <ViewportLayoutPicker layout={layout} onApply={handleApply} />
      </PopoverContent>
    </Popover>
  );
}
