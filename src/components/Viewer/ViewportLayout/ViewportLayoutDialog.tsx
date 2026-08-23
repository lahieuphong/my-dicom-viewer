'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import {
  COMMON_VIEWPORT_LAYOUTS,
  isSameViewportLayout,
  MAX_VIEWPORT_COLUMNS,
  MAX_VIEWPORT_ROWS,
  type ViewportGridLayout,
} from './viewportLayout';

type ViewportLayoutDialogProps = {
  open: boolean;
  layout: ViewportGridLayout;
  onApply: (layout: ViewportGridLayout) => void;
  onClose: () => void;
};

function LayoutGlyph({
  rows,
  columns,
  className,
}: ViewportGridLayout & { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid h-8 w-12 gap-0.5', className)}
      style={{
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: rows * columns }, (_, index) => (
        <span
          key={index}
          className="rounded-[2px] border border-current bg-current/10"
        />
      ))}
    </span>
  );
}
export default function ViewportLayoutDialog({
  open,
  layout,
  onApply,
  onClose,
}: ViewportLayoutDialogProps) {
  const [hoveredLayout, setHoveredLayout] =
    useState<ViewportGridLayout | null>(null);

  useEffect(() => {
    if (!open) setHoveredLayout(null);
  }, [open]);

  const customPreview = hoveredLayout ?? layout;

  const apply = (nextLayout: ViewportGridLayout) => {
    onApply(nextLayout);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        data-testid="viewport-layout-dialog"
        className="w-[calc(100dvw-1rem)] max-w-[36rem] gap-0 overflow-hidden border-primary/30 bg-card p-0 shadow-2xl sm:w-[min(92dvw,36rem)]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLElement>('[data-testid="other-tools-trigger"]')
            ?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="border-b border-border px-4 py-4 pr-12 sm:px-5 sm:pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <LayoutGrid className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg text-primary sm:text-xl">
                Tách cửa sổ
              </DialogTitle>
              <DialogDescription className="mt-1 truncate text-xs sm:text-sm">
                Chọn bố cục viewport để so sánh nhiều series hoặc lát cắt.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-5 p-4 sm:grid-cols-[1.1fr_0.9fr] sm:p-5">
          <section aria-labelledby="common-layout-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3
                id="common-layout-heading"
                className="text-sm font-semibold text-foreground"
              >
                Bố cục thường dùng
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                Hiện tại: {layout.rows} × {layout.columns}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {COMMON_VIEWPORT_LAYOUTS.map((preset) => {
                const active = isSameViewportLayout(layout, preset);
                return (
                  <button
                    key={`${preset.rows}x${preset.columns}`}
                    type="button"
                    className={cn(
                      'flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      active
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border bg-background text-foreground hover:border-primary/60 hover:bg-muted'
                    )}
                    aria-pressed={active}
                    aria-label={`Bố cục ${preset.rows} hàng ${preset.columns} cột`}
                    onClick={() => apply(preset)}
                  >
                    <LayoutGlyph {...preset} />
                    <span className="font-medium tabular-nums">
                      {preset.rows} × {preset.columns}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="custom-layout-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3
                id="custom-layout-heading"
                className="text-sm font-semibold text-foreground"
              >
                Tùy chỉnh
              </h3>
              <span className="text-xs font-medium tabular-nums text-primary">
                {customPreview.rows} × {customPreview.columns}
              </span>
            </div>
            <div
              className="grid aspect-[4/3] w-full max-w-56 gap-1 rounded-xl border border-border bg-background p-2"
              style={{
                gridTemplateRows: `repeat(${MAX_VIEWPORT_ROWS}, minmax(0, 1fr))`,
                gridTemplateColumns: `repeat(${MAX_VIEWPORT_COLUMNS}, minmax(0, 1fr))`,
              }}
              onMouseLeave={() => setHoveredLayout(null)}
              aria-label="Chọn số hàng và cột"
            >
              {Array.from(
                { length: MAX_VIEWPORT_ROWS * MAX_VIEWPORT_COLUMNS },
                (_, index) => {
                  const row = Math.floor(index / MAX_VIEWPORT_COLUMNS) + 1;
                  const column = (index % MAX_VIEWPORT_COLUMNS) + 1;
                  const preview = hoveredLayout ?? layout;
                  const highlighted =
                    row <= preview.rows && column <= preview.columns;

                  return (
                    <button
                      key={`${row}-${column}`}
                      type="button"
                      className={cn(
                        'min-h-8 rounded border transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        highlighted
                          ? 'border-primary bg-primary/75'
                          : 'border-border bg-muted hover:border-primary/50'
                      )}
                      aria-label={`${row} hàng ${column} cột`}
                      onMouseEnter={() =>
                        setHoveredLayout({ rows: row, columns: column })
                      }
                      onFocus={() =>
                        setHoveredLayout({ rows: row, columns: column })
                      }
                      onClick={() => apply({ rows: row, columns: column })}
                    />
                  );
                }
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Di chuột để xem trước, sau đó bấm ô cuối của vùng cần tạo.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
