'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import {
  COMMON_VIEWPORT_LAYOUTS,
  isSameViewportLayout,
  MAX_VIEWPORT_COLUMNS,
  MAX_VIEWPORT_ROWS,
  type ViewportGridLayout,
} from './viewportLayout';

type ViewportLayoutPickerProps = {
  layout: ViewportGridLayout;
  onApply: (layout: ViewportGridLayout) => void;
};

function LayoutGlyph({
  rows,
  columns,
  className,
}: ViewportGridLayout & { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid h-7 w-11 gap-0.5', className)}
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

/** Pure layout chooser shared by the toolbar popover and future surfaces. */
export default function ViewportLayoutPicker({
  layout,
  onApply,
}: ViewportLayoutPickerProps) {
  const [hoveredLayout, setHoveredLayout] =
    useState<ViewportGridLayout | null>(null);
  const customPreview = hoveredLayout ?? layout;

  return (
    <div className="grid min-w-0 sm:grid-cols-[minmax(0,1fr)_11.5rem]">
      <section
        aria-labelledby="common-layout-heading"
        className="min-w-0 border-b border-border p-3.5 sm:border-b-0 sm:border-r"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3
            id="common-layout-heading"
            className="text-sm font-semibold text-foreground"
          >
            Bố cục thường dùng
          </h3>
          <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold tabular-nums text-primary">
            {layout.rows} × {layout.columns}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {COMMON_VIEWPORT_LAYOUTS.map((preset) => {
            const active = isSameViewportLayout(layout, preset);
            return (
              <button
                key={`${preset.rows}x${preset.columns}`}
                type="button"
                className={cn(
                  'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border px-1.5 py-2 text-xs transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-background text-foreground hover:border-primary/60 hover:bg-muted'
                )}
                aria-pressed={active}
                aria-label={`Bố cục ${preset.rows} hàng ${preset.columns} cột`}
                title={`${preset.rows} × ${preset.columns}`}
                onClick={() => onApply(preset)}
              >
                <LayoutGlyph {...preset} />
                <span className="font-medium tabular-nums">
                  {preset.rows} × {preset.columns}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Chọn nhanh một bố cục để so sánh nhiều series hoặc lát cắt.
        </p>
      </section>

      <section
        aria-labelledby="custom-layout-heading"
        className="min-w-0 bg-muted/20 p-3.5"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3
            id="custom-layout-heading"
            className="text-sm font-semibold text-foreground"
          >
            Tùy chỉnh
          </h3>
          <span className="text-xs font-semibold tabular-nums text-primary">
            {customPreview.rows} × {customPreview.columns}
          </span>
        </div>

        <div
          className="grid aspect-[4/3] w-full gap-1 rounded-lg border border-border bg-background p-2"
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
              const highlighted =
                row <= customPreview.rows &&
                column <= customPreview.columns;

              return (
                <button
                  key={`${row}-${column}`}
                  type="button"
                  className={cn(
                    'min-h-7 rounded-[3px] border transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
                  onClick={() => onApply({ rows: row, columns: column })}
                />
              );
            }
          )}
        </div>

        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          Di chuột để xem trước, bấm để áp dụng.
        </p>
      </section>
    </div>
  );
}
