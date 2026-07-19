'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { Check, LoaderCircle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  createDefaultCaptureFilename,
  createViewportCaptureBlob,
  getCapturePreviewDimensions,
  getViewportCaptureDimensions,
  sanitizeCaptureFilename,
  type CaptureFormat,
} from '@/lib/viewer/captureImage';

import ToolbarTooltip from './ToolbarTooltip';
import { CAPTURE_TOOLTIP } from './tooltips';

interface CaptureControlProps {
  viewportEl: HTMLDivElement | null;
}

const MAX_CAPTURE_DIMENSION = 8192;
const PREVIEW_DEBOUNCE_MS = 140;

function FormatDropdown({
  format,
  disabled,
  onChange,
}: {
  format: CaptureFormat;
  disabled?: boolean;
  onChange: (format: CaptureFormat) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="w-full justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          aria-label="Select image format"
        >
          <span className="font-medium">{format === 'png' ? 'PNG' : 'JPG'}</span>
          <svg
            className="ml-2 size-4 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        className="z-[110] w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
      >
        <DropdownMenuItem
          className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"
          onClick={() => onChange('png')}
        >
          <div className="flex items-center gap-3">
            <span className="font-medium">PNG</span>
            <span className="text-xs text-muted-foreground">lossless</span>
          </div>
          {format === 'png' && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"
          onClick={() => onChange('jpeg')}
        >
          <div className="flex items-center gap-3">
            <span className="font-medium">JPG</span>
            <span className="text-xs text-muted-foreground">smaller</span>
          </div>
          {format === 'jpeg' && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function CaptureControl({ viewportEl }: CaptureControlProps) {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState(() => createDefaultCaptureFilename());
  const [format, setFormat] = useState<CaptureFormat>('png');
  const [widthPx, setWidthPx] = useState<number | null>(null);
  const [heightPx, setHeightPx] = useState<number | null>(null);
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [includeWarning, setIncludeWarning] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const previewUrlRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);

  const replacePreviewUrl = useCallback((nextUrl: string | null) => {
    const previousUrl = previewUrlRef.current;
    if (previousUrl && previousUrl !== nextUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    previewUrlRef.current = nextUrl;
    if (mountedRef.current) setPreviewUrl(nextUrl);
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      previewRequestRef.current += 1;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  const close = useCallback(() => {
    previewRequestRef.current += 1;
    setOpen(false);
    setIsPreviewing(false);
    setPreviewError(null);
    setSaveError(null);
    replacePreviewUrl(null);
  }, [replacePreviewUrl]);

  const handleOpen = () => {
    previewRequestRef.current += 1;
    replacePreviewUrl(null);
    setFilename(createDefaultCaptureFilename());
    setWidthPx(null);
    setHeightPx(null);
    setPreviewError(null);
    setSaveError(null);
    setIsPreviewing(true);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    try {
      if (!viewportEl) throw new Error('Viewport is not ready');
      const dimensions = getViewportCaptureDimensions(viewportEl);
      setWidthPx(dimensions.width);
      setHeightPx(dimensions.height);
    } catch {
      setPreviewError('Viewport chưa sẵn sàng để chụp ảnh.');
    }
  }, [open, viewportEl]);

  const generatePreview = useCallback(async () => {
    if (!open || !viewportEl || widthPx == null || heightPx == null) return;

    const requestId = ++previewRequestRef.current;
    setIsPreviewing(true);
    setPreviewError(null);

    try {
      const dimensions = getCapturePreviewDimensions(widthPx, heightPx);
      const blob = await createViewportCaptureBlob({
        viewportEl,
        width: dimensions.width,
        height: dimensions.height,
        format,
        quality: 0.88,
        includeAnnotations,
        includeWarning,
      });
      const nextUrl = URL.createObjectURL(blob);

      if (!mountedRef.current || previewRequestRef.current !== requestId) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      replacePreviewUrl(nextUrl);
    } catch {
      if (mountedRef.current && previewRequestRef.current === requestId) {
        setPreviewError('Không thể tạo ảnh xem trước. Vui lòng thử lại.');
      }
    } finally {
      if (mountedRef.current && previewRequestRef.current === requestId) {
        setIsPreviewing(false);
      }
    }
  }, [
    format,
    heightPx,
    includeAnnotations,
    includeWarning,
    open,
    replacePreviewUrl,
    viewportEl,
    widthPx,
  ]);

  useEffect(() => {
    if (!open || widthPx == null || heightPx == null) return;

    // Invalidate an older render immediately and show feedback during debounce.
    previewRequestRef.current += 1;
    setIsPreviewing(true);
    setPreviewError(null);

    const timer = window.setTimeout(() => {
      void generatePreview();
    }, PREVIEW_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [generatePreview, heightPx, open, widthPx]);

  const handleSave = async () => {
    if (!viewportEl || isSaving || widthPx == null || heightPx == null) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const blob = await createViewportCaptureBlob({
        viewportEl,
        width: widthPx,
        height: heightPx,
        format,
        quality: 0.92,
        includeAnnotations,
        includeWarning,
      });
      const safeFilename = sanitizeCaptureFilename(
        filename,
        createDefaultCaptureFilename()
      );
      const extension = format === 'png' ? 'png' : 'jpg';

      setFilename(safeFilename);
      saveAs(blob, `${safeFilename}.${extension}`);
      close();
    } catch {
      if (mountedRef.current) {
        setSaveError('Không thể lưu ảnh. Vui lòng thử lại.');
      }
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  };

  const parseDimension = (value: string): number | null => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return null;
    return Math.min(MAX_CAPTURE_DIMENSION, Math.max(1, parsed));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <ToolbarTooltip label={CAPTURE_TOOLTIP.label} detail={CAPTURE_TOOLTIP.detail}>
        <Button
          variant="ghost"
          onClick={handleOpen}
          className="flex size-8 items-center justify-center rounded-md border border-border p-0 sm:size-9"
          aria-label={`${CAPTURE_TOOLTIP.label} — ${CAPTURE_TOOLTIP.detail}`}
        >
          <i className="fas fa-camera" />
        </Button>
      </ToolbarTooltip>

      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[100] bg-black/65 backdrop-blur-sm"
        className="z-[101] flex max-h-[calc(100dvh-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl border-border bg-card p-0 shadow-2xl sm:max-w-none md:h-[min(760px,85dvh)] md:flex-row"
        style={{
          width: 'min(1100px, calc(100vw - 1rem))',
          maxWidth: 'calc(100vw - 1rem)',
        }}
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSaving) event.preventDefault();
        }}
      >
        <DialogDescription className="sr-only">
          Xem trước và tải ảnh chất lượng cao từ DICOM viewport hiện tại.
        </DialogDescription>

        <section
          className="relative flex min-h-[240px] min-w-0 flex-1 items-center justify-center overflow-auto bg-black p-4 sm:p-6 md:min-h-0"
          aria-label="Image preview"
          aria-busy={isPreviewing}
        >
          <div className="relative flex min-h-[220px] w-full max-w-[900px] items-center justify-center overflow-hidden rounded-lg bg-black shadow-lg md:min-h-[420px]">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="DICOM capture preview"
                className="max-h-full max-w-full object-contain"
              />
            ) : previewError ? (
              <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-sm text-red-300">
                <span>{previewError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void generatePreview()}
                  disabled={!viewportEl || isPreviewing}
                  className="border-white/25 bg-white/5 text-white hover:bg-white/10"
                >
                  <RefreshCw className="size-4" />
                  Thử lại
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-sm text-white/75">
                <LoaderCircle className="size-7 animate-spin text-primary" />
                <span>Đang tạo ảnh xem trước…</span>
              </div>
            )}

            {previewUrl && isPreviewing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
                <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/65 px-4 py-2 text-sm text-white shadow-lg">
                  <LoaderCircle className="size-4 animate-spin text-primary" />
                  Đang cập nhật…
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="max-h-[52dvh] w-full shrink-0 overflow-y-auto bg-card p-5 text-foreground sm:p-6 md:max-h-none md:w-[390px]">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className="pt-1 text-lg font-semibold leading-tight">
              Download High Quality Image
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-xl text-muted-foreground hover:text-foreground"
              onClick={close}
              disabled={isSaving}
              aria-label="Close"
            >
              <i className="fas fa-times" />
            </Button>
          </div>

          <div className="mt-4">
            <label htmlFor="capture-filename" className="mb-1 block text-xs">
              File name
            </label>
            <input
              id="capture-filename"
              className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              disabled={isSaving}
              autoComplete="off"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-xs">Format</label>
              <FormatDropdown
                format={format}
                disabled={isSaving}
                onChange={setFormat}
              />
            </div>
            <div>
              <label htmlFor="capture-width" className="mb-1 block text-xs">
                W (px)
              </label>
              <input
                id="capture-width"
                className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={widthPx ?? ''}
                onChange={(event) => setWidthPx(parseDimension(event.target.value))}
                inputMode="numeric"
                disabled={isSaving}
              />
            </div>
            <div>
              <label htmlFor="capture-height" className="mb-1 block text-xs">
                H (px)
              </label>
              <input
                id="capture-height"
                className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={heightPx ?? ''}
                onChange={(event) => setHeightPx(parseDimension(event.target.value))}
                inputMode="numeric"
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                id="include-annotations"
                checked={includeAnnotations}
                onCheckedChange={(value) => setIncludeAnnotations(Boolean(value))}
                disabled={isSaving}
              />
              <span>Include annotations</span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                id="include-warning"
                checked={includeWarning}
                onCheckedChange={(value) => setIncludeWarning(Boolean(value))}
                disabled={isSaving}
              />
              <span>Include warning message</span>
            </label>
          </div>

          {saveError && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {saveError}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={isSaving}
              className="border border-border"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleSave()}
              disabled={
                isSaving ||
                isPreviewing ||
                !viewportEl ||
                widthPx == null ||
                heightPx == null
              }
            >
              {isSaving && <LoaderCircle className="size-4 animate-spin" />}
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
