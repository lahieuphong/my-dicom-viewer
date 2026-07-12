'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, LoaderCircle } from 'lucide-react';

import { initCornerstone } from '@/lib/cornerstone/init';
import { cn } from '@/lib/utils';

type DicomSeriesThumbnailProps = {
  imageId?: string;
  label: string;
};

type ThumbnailStatus = 'loading' | 'ready' | 'error';

type ThumbnailImage = {
  rows: number;
  columns: number;
  color?: boolean;
  rgba?: boolean;
  numberOfComponents?: number;
  minPixelValue: number;
  maxPixelValue: number;
  slope: number;
  intercept: number;
  windowCenter: number | number[];
  windowWidth: number | number[];
  invert?: boolean;
  getPixelData: () => ArrayLike<number>;
};

function firstNumber(value: number | number[] | undefined) {
  const resolved = Array.isArray(value) ? value[0] : value;
  return typeof resolved === 'number' && Number.isFinite(resolved) ? resolved : null;
}

function canvasHasVisiblePixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context || canvas.width <= 0 || canvas.height <= 0) return false;

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const sampleStep = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);
  for (let index = 0; index < pixels.length; index += sampleStep) {
    if (pixels[index] > 5 || pixels[index + 1] > 5 || pixels[index + 2] > 5) {
      return true;
    }
  }
  return false;
}

function renderDecodedPixels(canvas: HTMLCanvasElement, image: ThumbnailImage) {
  const width = Math.max(1, image.columns);
  const height = Math.max(1, image.rows);
  const pixelData = image.getPixelData();
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('Thumbnail canvas context is unavailable');

  const imageData = sourceContext.createImageData(width, height);
  const output = imageData.data;
  const pixelCount = width * height;

  if (image.color && (image.numberOfComponents ?? 0) >= 3) {
    const components = image.numberOfComponents ?? (image.rgba ? 4 : 3);
    for (let index = 0; index < pixelCount; index += 1) {
      const sourceIndex = index * components;
      const outputIndex = index * 4;
      output[outputIndex] = pixelData[sourceIndex] ?? 0;
      output[outputIndex + 1] = pixelData[sourceIndex + 1] ?? 0;
      output[outputIndex + 2] = pixelData[sourceIndex + 2] ?? 0;
      output[outputIndex + 3] = 255;
    }
  } else {
    const slope = Number.isFinite(image.slope) ? image.slope : 1;
    const intercept = Number.isFinite(image.intercept) ? image.intercept : 0;
    const minValue = image.minPixelValue * slope + intercept;
    const maxValue = image.maxPixelValue * slope + intercept;
    const windowCenter = firstNumber(image.windowCenter);
    const windowWidth = firstNumber(image.windowWidth);
    const lower = windowCenter != null && windowWidth != null && windowWidth > 1
      ? windowCenter - windowWidth / 2
      : minValue;
    const upper = windowCenter != null && windowWidth != null && windowWidth > 1
      ? windowCenter + windowWidth / 2
      : maxValue;
    const range = Math.max(1, upper - lower);

    for (let index = 0; index < pixelCount; index += 1) {
      const scaledValue = (pixelData[index] ?? 0) * slope + intercept;
      let grayscale = Math.round(((scaledValue - lower) / range) * 255);
      grayscale = Math.max(0, Math.min(255, grayscale));
      if (image.invert) grayscale = 255 - grayscale;

      const outputIndex = index * 4;
      output[outputIndex] = grayscale;
      output[outputIndex + 1] = grayscale;
      output[outputIndex + 2] = grayscale;
      output[outputIndex + 3] = 255;
    }
  }

  sourceContext.putImageData(imageData, 0, 0);

  canvas.width = 256;
  canvas.height = 256;
  const targetContext = canvas.getContext('2d');
  if (!targetContext) throw new Error('Thumbnail target context is unavailable');

  targetContext.fillStyle = '#000000';
  targetContext.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  targetContext.drawImage(
    sourceCanvas,
    (canvas.width - drawWidth) / 2,
    (canvas.height - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
}

export default function DicomSeriesThumbnail({
  imageId,
  label,
}: DicomSeriesThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<ThumbnailStatus>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageId) {
      setStatus('error');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    canvas.width = 256;
    canvas.height = 256;

    const renderThumbnail = async () => {
      const { csCore } = await initCornerstone();
      const loadAndCacheImage = csCore?.imageLoader?.loadAndCacheImage;
      const renderToCanvasCPU = csCore?.utilities?.renderToCanvasCPU;
      if (typeof loadAndCacheImage !== 'function' || typeof renderToCanvasCPU !== 'function') {
        throw new Error('Cornerstone thumbnail renderer is unavailable');
      }

      const image = (await loadAndCacheImage(imageId)) as ThumbnailImage;
      await renderToCanvasCPU(canvas, image);
      if (!canvasHasVisiblePixels(canvas)) {
        renderDecodedPixels(canvas, image);
      }

      if (cancelled) return;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      setStatus('ready');
    };

    void renderThumbnail().catch(() => {
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
    };
  }, [imageId]);

  return (
    <div className="relative size-full overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute inset-0 block size-full object-contain opacity-0 transition-opacity duration-200',
          status === 'ready' && 'opacity-100'
        )}
        role="img"
        aria-label={label}
      />

      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-white/65">
          {status === 'loading' ? (
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
          ) : (
            <ImageIcon aria-hidden="true" className="size-5" />
          )}
        </div>
      )}
    </div>
  );
}
