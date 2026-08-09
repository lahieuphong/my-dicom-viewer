'use client';

import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const CALIBRATION_STEP_MM = 1;
const DISTANCE_INPUT_ID = 'calibration-distance-input';
const DISTANCE_HELP_ID = 'calibration-distance-help';
const DISTANCE_ERROR_ID = 'calibration-distance-error';
const APPLY_ERROR_ID = 'calibration-apply-error';

type CalibrationDialogProps = {
  open: boolean;
  defaultLength: number | null;
  isApplying?: boolean;
  applyError?: string | null;
  onCancel: () => void;
  onApply: (actualLength: number) => Promise<boolean> | boolean;
};

function formatDefaultLength(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(Math.round(value * 100) / 100);
}

export default function CalibrationDialog({
  open,
  defaultLength,
  isApplying = false,
  applyError = null,
  onCancel,
  onApply,
}: CalibrationDialogProps) {
  const [value, setValue] = useState('');
  const parsedValue = useMemo(() => {
    const normalized = value.trim();
    if (!normalized) return Number.NaN;
    return Number(normalized);
  }, [value]);
  const isValid = Number.isFinite(parsedValue) && parsedValue > 0;
  const hasValidationError = value.length > 0 && !isValid;
  const canDecrement = isValid && parsedValue > CALIBRATION_STEP_MM;
  const describedBy = [
    DISTANCE_HELP_ID,
    hasValidationError ? DISTANCE_ERROR_ID : null,
    applyError ? APPLY_ERROR_ID : null,
  ]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (open) setValue(formatDefaultLength(defaultLength));
  }, [defaultLength, open]);

  const submit = () => {
    if (!isApplying && isValid) void onApply(parsedValue);
  };

  const changeByStep = (direction: -1 | 1) => {
    if (isApplying) return;

    if (!isValid) {
      if (direction > 0) setValue(String(CALIBRATION_STEP_MM));
      return;
    }

    const nextValue = parsedValue + direction * CALIBRATION_STEP_MM;
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;

    // Avoid exposing floating-point artifacts while preserving decimals the
    // user entered (for example, 117.73 -> 118.73).
    setValue(String(Number(nextValue.toFixed(12))));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isApplying) onCancel();
      }}
    >
      <DialogContent
        data-testid="calibration-dialog"
        aria-busy={isApplying}
        onEscapeKeyDown={(event) => {
          if (isApplying) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isApplying) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Calibration</DialogTitle>
          <DialogDescription>
            Nhập khoảng cách vật lý thực tế giữa hai điểm, tính bằng milimét.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <label
            htmlFor={DISTANCE_INPUT_ID}
            className="flex items-center justify-between gap-3 text-sm font-medium"
          >
            <span>Khoảng cách thực tế</span>
            <span className="text-xs font-normal text-muted-foreground">
              milimét
            </span>
          </label>

          <div
            role="group"
            aria-label="Điều chỉnh khoảng cách thực tế"
            className={cn(
              'flex h-12 w-full overflow-hidden rounded-xl border border-border bg-background shadow-xs transition-[border-color,box-shadow,opacity]',
              'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25',
              hasValidationError &&
                'border-destructive focus-within:border-destructive focus-within:ring-destructive/20',
              isApplying && 'opacity-60'
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isApplying || !canDecrement}
              aria-label={`Giảm khoảng cách ${CALIBRATION_STEP_MM} mm`}
              aria-controls={DISTANCE_INPUT_ID}
              data-testid="calibration-decrement"
              className="h-full w-12 shrink-0 rounded-none border-r border-border text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              onClick={() => changeByStep(-1)}
            >
              <Minus className="size-4" aria-hidden="true" />
            </Button>

            <div className="relative min-w-0 flex-1">
              <Input
                id={DISTANCE_INPUT_ID}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={value}
                disabled={isApplying}
                autoFocus
                aria-label="Khoảng cách thực tế (mm)"
                aria-describedby={describedBy}
                aria-invalid={hasValidationError}
                placeholder="Nhập khoảng cách"
                data-testid="calibration-distance-input"
                className="h-full rounded-none border-0 bg-transparent px-4 pr-14 text-center text-base font-semibold tabular-nums shadow-none [appearance:textfield] focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent aria-invalid:border-0 aria-invalid:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    changeByStep(1);
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    changeByStep(-1);
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-semibold text-muted-foreground"
              >
                mm
              </span>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isApplying}
              aria-label={`Tăng khoảng cách ${CALIBRATION_STEP_MM} mm`}
              aria-controls={DISTANCE_INPUT_ID}
              data-testid="calibration-increment"
              className="h-full w-12 shrink-0 rounded-none border-l border-border text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              onClick={() => changeByStep(1)}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <p id={DISTANCE_HELP_ID} className="text-xs text-muted-foreground">
            Dùng − / + để thay đổi 1 mm hoặc nhập giá trị chính xác.
          </p>

          {hasValidationError && (
            <p
              id={DISTANCE_ERROR_ID}
              className="text-sm text-destructive"
              role="alert"
            >
              Khoảng cách thực tế phải là một số lớn hơn 0.
            </p>
          )}
          {applyError && (
            <p
              id={APPLY_ERROR_ID}
              className="text-sm text-destructive"
              role="alert"
            >
              {applyError}
            </p>
          )}
        </div>

        <DialogFooter className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={isApplying}
            data-testid="calibration-cancel"
            onClick={onCancel}
          >
            Hủy
          </Button>
          <Button
            type="button"
            disabled={isApplying || !isValid}
            data-testid="calibration-apply"
            onClick={submit}
          >
            {isApplying ? 'Đang áp dụng...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
