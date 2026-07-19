export type CaptureFormat = 'png' | 'jpeg';

export interface CreateViewportCaptureBlobOptions {
  viewportEl: HTMLElement;
  width: number;
  height: number;
  format: CaptureFormat;
  quality: number;
  includeAnnotations: boolean;
  includeWarning: boolean;
}

type CaptureLayer =
  | {
      type: 'canvas';
      element: HTMLCanvasElement;
      rect: DOMRect;
    }
  | {
      type: 'svg';
      element: SVGElement;
      rect: DOMRect;
    };

const CAPTURE_EXTENSION_PATTERN = /\.(?:png|jpe?g)$/i;
const FORBIDDEN_FILENAME_PATTERN = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g;
const DEFAULT_WARNING = 'Not For Diagnostic Use';

function padDatePart(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

/** Creates a readable, filesystem-safe filename using the user's local time. */
export function createDefaultCaptureFilename(date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Cannot create a capture filename from an invalid date.');
  }

  return [
    'image',
    padDatePart(date.getFullYear(), 4),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
  ].join('-');
}

function normalizeFilename(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(CAPTURE_EXTENSION_PATTERN, '')
    .replace(FORBIDDEN_FILENAME_PATTERN, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
}

/** Removes duplicate image extensions and characters that are unsafe in downloaded filenames. */
export function sanitizeCaptureFilename(value: string, fallback?: string): string {
  const normalized = normalizeFilename(value);
  if (normalized) return normalized;

  const normalizedFallback = normalizeFilename(fallback ?? createDefaultCaptureFilename());
  return normalizedFallback || createDefaultCaptureFilename();
}

function getViewportRect(viewportEl: HTMLElement): DOMRect {
  if (!viewportEl) {
    throw new Error('Cannot capture an image because the viewport element is missing.');
  }

  const rect = viewportEl.getBoundingClientRect();
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new Error('Cannot capture an image because the viewport has no visible dimensions.');
  }

  return rect;
}

/** Returns the current viewport dimensions in CSS pixels. */
export function getViewportCaptureDimensions(viewportEl: HTMLElement): {
  width: number;
  height: number;
} {
  const rect = getViewportRect(viewportEl);
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function assertPositiveDimension(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
}

/** Fits a preview inside the requested bounds without enlarging or distorting it. */
export function getCapturePreviewDimensions(
  width: number,
  height: number,
  maxWidth = 960,
  maxHeight = 720
): { width: number; height: number } {
  assertPositiveDimension(width, 'Capture width');
  assertPositiveDimension(height, 'Capture height');
  assertPositiveDimension(maxWidth, 'Maximum preview width');
  assertPositiveDimension(maxHeight, 'Maximum preview height');

  const scale = Math.min(1, maxWidth / width, maxHeight / height);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function getRelativeRect(element: Element, viewportRect: DOMRect): DOMRect {
  const rect = element.getBoundingClientRect();
  return new DOMRect(
    rect.left - viewportRect.left,
    rect.top - viewportRect.top,
    rect.width,
    rect.height
  );
}

function hasDrawableSvgContent(svg: SVGElement): boolean {
  const drawableElements = svg.querySelectorAll(
    'path, line, polyline, polygon, rect, circle, ellipse, text, image, use, foreignObject'
  );

  return Array.from(drawableElements).some((element) => !element.closest('defs'));
}

function collectCaptureLayers(
  viewportEl: HTMLElement,
  viewportRect: DOMRect
): { layers: CaptureLayer[]; mainCanvas: HTMLCanvasElement } {
  const layers: CaptureLayer[] = Array.from(
    viewportEl.querySelectorAll<HTMLCanvasElement | SVGElement>('canvas, svg')
  ).flatMap<CaptureLayer>((element): CaptureLayer[] => {
    const rect = getRelativeRect(element, viewportRect);
    if (element instanceof HTMLCanvasElement) {
      return [{ type: 'canvas' as const, element, rect }];
    }
    // Cornerstone keeps an empty SVG annotation layer mounted even when the
    // viewport has no annotations. Skipping it avoids an unnecessary SVG
    // serialize/decode round-trip on every preview.
    if (!hasDrawableSvgContent(element)) return [];
    return [{ type: 'svg' as const, element, rect }];
  });

  const canvasLayers = layers.filter(
    (layer): layer is Extract<CaptureLayer, { type: 'canvas' }> =>
      layer.type === 'canvas' &&
      layer.element.width > 0 &&
      layer.element.height > 0 &&
      layer.rect.width > 0 &&
      layer.rect.height > 0
  );

  const mainCanvasLayer = canvasLayers.reduce<
    Extract<CaptureLayer, { type: 'canvas' }> | undefined
  >((largest, layer) => {
    if (!largest) return layer;
    const area = layer.rect.width * layer.rect.height;
    const largestArea = largest.rect.width * largest.rect.height;
    return area > largestArea ? layer : largest;
  }, undefined);

  if (!mainCanvasLayer) {
    throw new Error('Cannot capture an image because the viewport has no renderable canvas.');
  }

  return { layers, mainCanvas: mainCanvasLayer.element };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function drawCanvasLayer(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  if (typeof globalThis.createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      // Reading a WebGL canvas directly through drawImage can block the main
      // thread. ImageBitmap lets the browser perform that transfer off-thread.
      bitmap = await globalThis.createImageBitmap(canvas);
      context.drawImage(bitmap, x, y, width, height);
      return;
    } catch {
      // Fall back to drawImage for browsers/drivers that cannot snapshot the
      // Cornerstone canvas as an ImageBitmap.
    } finally {
      bitmap?.close();
    }
  }

  try {
    context.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, width, height);
  } catch (error) {
    throw new Error(`Failed to draw a viewport canvas: ${describeError(error)}`);
  }
}

async function drawSvgWithImageElement(
  context: CanvasRenderingContext2D,
  blob: Blob,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.crossOrigin = 'anonymous';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The browser could not decode an SVG overlay.'));
      element.src = objectUrl;
    });

    context.drawImage(image, x, y, width, height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function drawSvgLayer(
  context: CanvasRenderingContext2D,
  svg: SVGElement,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('width', String(Math.max(1, Math.round(width))));
  clone.setAttribute('height', String(Math.max(1, Math.round(height))));

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: 'image/svg+xml;charset=utf-8',
  });

  if (typeof globalThis.createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await globalThis.createImageBitmap(blob);
      context.drawImage(bitmap, x, y, width, height);
      return;
    } catch {
      // Safari and some Chromium versions cannot decode every SVG through ImageBitmap.
      // The image-element path below is slower but broadly supported.
    } finally {
      bitmap?.close();
    }
  }

  try {
    await drawSvgWithImageElement(context, blob, x, y, width, height);
  } catch (error) {
    throw new Error(`Failed to draw an SVG annotation layer: ${describeError(error)}`);
  }
}

function drawWarningOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const fontSize = Math.max(10, Math.round(width * 0.025));
  context.save();

  try {
    context.font = `bold ${fontSize}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';

    const paddingX = Math.max(8, Math.round(fontSize * 0.6));
    const paddingY = Math.max(6, Math.round(fontSize * 0.4));
    const rectWidth = context.measureText(DEFAULT_WARNING).width + paddingX * 2;
    const rectHeight = fontSize + paddingY * 2;
    const textX = width / 2;
    const textY = height - paddingY - 4;
    const rectX = textX - rectWidth / 2;
    const rectY = textY - rectHeight;
    const radius = 6;

    context.beginPath();
    context.moveTo(rectX + radius, rectY);
    context.arcTo(rectX + rectWidth, rectY, rectX + rectWidth, rectY + rectHeight, radius);
    context.arcTo(rectX + rectWidth, rectY + rectHeight, rectX, rectY + rectHeight, radius);
    context.arcTo(rectX, rectY + rectHeight, rectX, rectY, radius);
    context.arcTo(rectX, rectY, rectX + rectWidth, rectY, radius);
    context.closePath();

    context.fillStyle = 'rgba(0,0,0,0.65)';
    context.fill();
    context.fillStyle = '#e6e6e6';
    context.fillText(DEFAULT_WARNING, textX, textY - paddingY);
  } finally {
    context.restore();
  }
}

function convertCanvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('The browser returned an empty image blob.'));
      }, mimeType, quality);
    } catch (error) {
      reject(new Error(`Failed to encode the captured image: ${describeError(error)}`));
    }
  });
}

/** Composites the rendered image, optional annotations, and warning into an export blob. */
export async function createViewportCaptureBlob({
  viewportEl,
  width,
  height,
  format,
  quality,
  includeAnnotations,
  includeWarning,
}: CreateViewportCaptureBlobOptions): Promise<Blob> {
  assertPositiveDimension(width, 'Capture width');
  assertPositiveDimension(height, 'Capture height');

  if (format !== 'png' && format !== 'jpeg') {
    throw new Error(`Unsupported capture format: ${String(format)}.`);
  }

  const outputWidth = Math.max(1, Math.round(width));
  const outputHeight = Math.max(1, Math.round(height));
  const viewportRect = getViewportRect(viewportEl);
  const { layers, mainCanvas } = collectCaptureLayers(viewportEl, viewportRect);

  const outputCanvas = document.createElement('canvas');
  // Width and height are already expressed in output pixels. Do not multiply by DPR.
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;

  const context = outputCanvas.getContext('2d');
  if (!context) {
    throw new Error('Cannot capture an image because a 2D canvas context is unavailable.');
  }

  context.fillStyle = '#000';
  context.fillRect(0, 0, outputWidth, outputHeight);

  for (const layer of layers) {
    if (layer.rect.width <= 0 || layer.rect.height <= 0) continue;
    if (!includeAnnotations) {
      if (layer.type === 'svg') continue;
      if (layer.element !== mainCanvas) continue;
    }

    const x = (layer.rect.left / viewportRect.width) * outputWidth;
    const y = (layer.rect.top / viewportRect.height) * outputHeight;
    const layerWidth = (layer.rect.width / viewportRect.width) * outputWidth;
    const layerHeight = (layer.rect.height / viewportRect.height) * outputHeight;

    if (layer.type === 'canvas') {
      await drawCanvasLayer(context, layer.element, x, y, layerWidth, layerHeight);
    } else {
      await drawSvgLayer(context, layer.element, x, y, layerWidth, layerHeight);
    }
  }

  if (includeWarning) {
    drawWarningOverlay(context, outputWidth, outputHeight);
  }

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const normalizedQuality = Number.isFinite(quality) ? Math.min(1, Math.max(0, quality)) : 0.92;

  return convertCanvasToBlob(outputCanvas, mimeType, normalizedQuality);
}
