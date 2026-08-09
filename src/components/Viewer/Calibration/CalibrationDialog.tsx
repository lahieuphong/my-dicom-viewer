'use client';

import { useEffect, useMemo, useState } from 'react';

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

  useEffect(() => {
    if (open) setValue(formatDefaultLength(defaultLength));
  }, [defaultLength, open]);

  const submit = () => {
    if (!isApplying && isValid) void onApply(parsedValue);
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

        <div className="space-y-2">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={value}
            disabled={isApplying}
            autoFocus
            aria-label="Khoảng cách thực tế (mm)"
            aria-invalid={value.length > 0 && !isValid}
            placeholder="Khoảng cách vật lý thực tế (mm)"
            data-testid="calibration-distance-input"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
          {value.length > 0 && !isValid && (
            <p className="text-sm text-destructive" role="alert">
              Khoảng cách thực tế phải là một số lớn hơn 0.
            </p>
          )}
          {applyError && (
            <p className="text-sm text-destructive" role="alert">
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
