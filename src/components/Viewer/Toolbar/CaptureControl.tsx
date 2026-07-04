'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { saveAs } from 'file-saver';

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

// shadcn checkbox
import { Checkbox } from '@/components/ui/checkbox';

// icon for dropdown selected check
import { Check } from 'lucide-react';

interface CaptureControlProps {
  viewportEl: HTMLDivElement | null;
}

type LayerType = 'canvas' | 'svg';

interface Layer {
  type: LayerType;
  el: Element;
  rect: DOMRect;
  zIndex: number;
}

/**
 * Small dropdown component for choosing PNG / JPG.
 * Uses our DropdownMenu + Button + theme-aware classes.
 */
function FormatDropdown({
  format,
  onChange,
}: {
  format: 'png' | 'jpeg';
  onChange: (f: 'png' | 'jpeg') => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between px-3 py-2 text-sm rounded-lg border border-border bg-white dark:bg-card dark:text-foreground"
          aria-label="Select image format"
        >
          <span className="font-medium">{format === 'png' ? 'PNG' : 'JPG'}</span>
          <svg
            className="ml-2 h-4 w-4 text-muted-foreground"
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
        className="w-44 p-1 bg-white dark:bg-card border border-border rounded-lg shadow-md"
      >
        <DropdownMenuItem
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm rounded-md hover:bg-muted"
          onClick={() => onChange('png')}
        >
          <div className="flex items-center gap-3">
            <span className="font-medium">PNG</span>
            <span className="text-xs text-muted-foreground">lossless</span>
          </div>
          {format === 'png' && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm rounded-md hover:bg-muted"
          onClick={() => onChange('jpeg')}
        >
          <div className="flex items-center gap-3">
            <span className="font-medium">JPG</span>
            <span className="text-xs text-muted-foreground">smaller</span>
          </div>
          {format === 'jpeg' && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function CaptureControl({ viewportEl }: CaptureControlProps) {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState(
    `capture_${new Date().toISOString().replace(/[:.]/g, '-')}`
  );
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [widthPx, setWidthPx] = useState<number | null>(null);
  const [heightPx, setHeightPx] = useState<number | null>(null);
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [includeWarning, setIncludeWarning] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const getRelativeRect = (el: Element, container: Element): DOMRect => {
    const elRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return new DOMRect(
      elRect.left - containerRect.left,
      elRect.top - containerRect.top,
      elRect.width,
      elRect.height
    );
  };

  const collectLayers = () => {
    if (!viewportEl)
      return {
        layers: [] as Layer[],
        viewportRect: new DOMRect(),
        mainCanvas: null as HTMLCanvasElement | null,
      };

    const nodeList = Array.from(viewportEl.querySelectorAll('canvas, svg')) as Element[];
    const viewportRect = viewportEl.getBoundingClientRect();

    const layers: Layer[] = nodeList.map((el) => {
      const type: LayerType = el.tagName.toLowerCase() as LayerType;
      const rect = getRelativeRect(el, viewportEl);
      const zIndex = parseInt(getComputedStyle(el).zIndex || '0', 10) || 0;
      return { type, el, rect, zIndex };
    });

    const canvases = layers
      .filter((l) => l.type === 'canvas')
      .map((l) => l.el as HTMLCanvasElement);
    let mainCanvas: HTMLCanvasElement | null = null;
    if (canvases.length) {
      let maxArea = 0;
      for (const c of canvases) {
        const r = (c as any).getBoundingClientRect?.() ?? (c as HTMLCanvasElement);
        const area = r.width * r.height;
        if (area > maxArea) {
          maxArea = area;
          mainCanvas = c;
        }
      }
    }

    return { layers, viewportRect, mainCanvas };
  };

  const drawCanvas = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number
  ) => {
    try {
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, w, h);
      return true;
    } catch (err) {
      console.warn('drawCanvas failed (CORS?):', err);
      return false;
    }
  };

  const drawSVG = async (
    ctx: CanvasRenderingContext2D,
    svg: SVGElement,
    x: number,
    y: number,
    w: number,
    h: number
  ) => {
    try {
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute('width', `${Math.max(1, Math.round(w))}`);
      clone.setAttribute('height', `${Math.max(1, Math.round(h))}`);

      const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
        type: 'image/svg+xml;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);

      return await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            ctx.drawImage(img, x, y, w, h);
            resolve(true);
          } catch (e) {
            console.error('drawSVG failed:', e);
            resolve(false);
          } finally {
            URL.revokeObjectURL(url);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(false);
        };
        img.src = url;
      });
    } catch (err) {
      console.warn('drawSVG top-level failed', err);
      return false;
    }
  };

  // NOTE: font scale reduced (0.025) and min 10px
  const drawWarningOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const text = 'Not For Diagnostic Use';
    const fontSize = Math.max(10, Math.round(width * 0.025)); // smaller than before
    ctx.save();
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const paddingX = Math.max(8, Math.round(fontSize * 0.6));
    const paddingY = Math.max(6, Math.round(fontSize * 0.4));
    const rectW = textW + paddingX * 2;
    const rectH = fontSize + paddingY * 2;

    const x = width / 2;
    const y = height - paddingY - 4;

    const rx = 6;
    const rectX = x - rectW / 2;
    const rectY = y - rectH;

    ctx.beginPath();
    ctx.moveTo(rectX + rx, rectY);
    ctx.arcTo(rectX + rectW, rectY, rectX + rectW, rectY + rectH, rx);
    ctx.arcTo(rectX + rectW, rectY + rectH, rectX, rectY + rectH, rx);
    ctx.arcTo(rectX, rectY + rectH, rectX, rectY, rx);
    ctx.arcTo(rectX, rectY, rectX + rectW, rectY, rx);
    ctx.closePath();

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fill();

    ctx.fillStyle = '#e6e6e6';
    ctx.fillText(text, x, y - paddingY);

    ctx.restore();
  };

  const buildCompositeBlob = async (
    width: number,
    height: number,
    mime: string,
    quality: number
  ): Promise<Blob> => {
    if (!viewportEl) throw new Error('Missing viewport element');
    setProcessing(true);

    const { layers, viewportRect, mainCanvas } = collectLayers();
    const dpr = window.devicePixelRatio || 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context not available');

    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    for (const layer of layers) {
      const x = (layer.rect.left / viewportRect.width) * width;
      const y = (layer.rect.top / viewportRect.height) * height;
      const w = (layer.rect.width / viewportRect.width) * width;
      const h = (layer.rect.height / viewportRect.height) * height;

      if (!includeAnnotations) {
        if (layer.type === 'svg') continue;
        if (layer.type === 'canvas') {
          const canvasEl = layer.el as HTMLCanvasElement;
          if (mainCanvas && canvasEl !== mainCanvas) continue;
        }
      }

      if (layer.type === 'canvas') {
        drawCanvas(ctx, layer.el as HTMLCanvasElement, x, y, w, h);
      } else {
        await drawSVG(ctx, layer.el as SVGElement, x, y, w, h);
      }
    }

    if (includeWarning) {
      try {
        drawWarningOverlay(ctx, width, height);
      } catch (err) {
        console.warn('Failed to draw warning overlay', err);
      }
    }

    try {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), mime, quality)
      );
      if (!blob) throw new Error('Failed to create blob from dest canvas');

      const url = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      return blob;
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const { viewportRect } = collectLayers();
    if (viewportRect && viewportRect.width && viewportRect.height) {
      setWidthPx((prev) => (prev == null ? Math.round(viewportRect.width) : prev));
      setHeightPx((prev) => (prev == null ? Math.round(viewportRect.height) : prev));
    }
  }, [open, viewportEl]);

  const handlePreview = async () => {
    if (!viewportEl) return;
    try {
      const { viewportRect } = collectLayers();
      if (!viewportRect || viewportRect.width === 0) return;

      const w = Math.max(1, Math.round(widthPx ?? viewportRect.width));
      const h = Math.max(1, Math.round(heightPx ?? viewportRect.height));
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      await buildCompositeBlob(w, h, mime, 0.92);
    } catch (err) {
      console.error('Preview failed', err);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | null = null;

    const tryPreview = () => {
      if (cancelled) return;
      handlePreview().catch((e) => console.error(e));
    };

    timer = window.setTimeout(tryPreview, 200);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [open, widthPx, heightPx, includeAnnotations, includeWarning, format, viewportEl]);

  const handleSave = async () => {
    if (!viewportEl) return alert('Viewport chưa sẵn sàng');
    try {
      const { viewportRect } = collectLayers();
      const w = Math.max(1, Math.round(widthPx ?? viewportRect.width));
      const h = Math.max(1, Math.round(heightPx ?? viewportRect.height));
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const blob = await buildCompositeBlob(w, h, mime, 0.92);
      const ext = format === 'png' ? 'png' : 'jpg';
      saveAs(blob, `${filename}.${ext}`);

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      setOpen(false);
    } catch (err) {
      console.error('Save failed', err);
      alert('Save failed: ' + err);
    }
  };

  const close = () => {
    setOpen(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const onChangeWidth = (v: string) => {
    const n = Number.parseInt(v || '', 10);
    if (Number.isNaN(n)) setWidthPx(null);
    else setWidthPx(Math.max(1, n));
  };
  const onChangeHeight = (v: string) => {
    const n = Number.parseInt(v || '', 10);
    if (Number.isNaN(n)) setHeightPx(null);
    else setHeightPx(Math.max(1, n));
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        title="Capture Image"
        onClick={() => setOpen(true)}
        className="w-8 h-8 sm:w-10 sm:h-10 p-0 flex items-center justify-center border border-border rounded-md"
      >
        <i className="fas fa-camera" />
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/30 backdrop-blur-sm">
          <div className="bg-card rounded-md shadow-2xl overflow-hidden flex w-[90%] max-w-[1100px] max-h-[85vh]">
            {/* LEFT: preview */}
            <div className="flex-1 p-6 overflow-auto flex items-start justify-center bg-black">
              <div className="w-[90%] max-w-[900px] bg-black p-6 rounded-lg shadow-lg">
                {previewUrl ? (
                  <img src={previewUrl} alt="preview" className="w-full h-auto" />
                ) : (
                  <div className="w-full h-[360px] flex flex-col items-center justify-center text-gray-400 text-sm">
                    <div className="mb-2 font-semibold text-white">Rendering preview…</div>
                    <div className="text-center max-w-[380px]">Please wait a moment.</div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: controls - support light/dark */}
            <div className="w-[380px] p-6 bg-white dark:bg-card dark:text-foreground text-foreground overflow-auto">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-foreground">Download High Quality Image</h3>

                <Button
                  variant="ghost"
                  size="icon"
                  className="text-secondary-foreground hover:text-foreground text-xl"
                  onClick={close}
                  aria-label="Close"
                >
                  <i className="fas fa-times" />
                </Button>
              </div>

              <div className="mt-4">
                <label className="block text-xs mb-1 text-foreground">File name</label>
                <input
                  className="w-full px-2 py-2 rounded border border-border text-sm bg-white dark:bg-card dark:text-foreground text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                />
              </div>

              <div className="flex gap-2 mt-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs mb-1 text-foreground">Format</label>

                  {/* Replaced with FormatDropdown component */}
                  <FormatDropdown format={format} onChange={(f) => setFormat(f)} />
                </div>

                <div className="flex gap-2 items-end">
                  <div>
                    <label className="block text-xs mb-1 text-foreground">W (px)</label>
                    <input
                      className="w-[100px] px-2 py-2 rounded border border-border text-sm bg-white dark:bg-card dark:text-foreground"
                      value={widthPx ?? ''}
                      onChange={(e) => onChangeWidth(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-foreground">H (px)</label>
                    <input
                      className="w-[100px] px-2 py-2 rounded border border-border text-sm bg-white dark:bg-card dark:text-foreground"
                      value={heightPx ?? ''}
                      onChange={(e) => onChangeHeight(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    id="include-annotations"
                    checked={includeAnnotations}
                    onCheckedChange={(v) => setIncludeAnnotations(Boolean(v))}
                  />
                  <span>Include annotations</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    id="include-warning"
                    checked={includeWarning}
                    onCheckedChange={(v) => setIncludeWarning(Boolean(v))}
                  />
                  <span>Include warning message</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                {/* Cancel with border */}
                <Button variant="ghost" size="sm" onClick={close} className="border border-border">
                  Cancel
                </Button>
                {/* Save always shows "Save" (no "Saving...") */}
                <Button variant="default" size="sm" onClick={handleSave} disabled={processing}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
