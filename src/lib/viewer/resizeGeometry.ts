// Framework-free geometry for keeping a pane's visible frame while it resizes.

export type ViewportSize = { width: number; height: number };

/** The canvas fields the geometry needs; an HTMLCanvasElement has them all. */
export type CanvasBox = {
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
};

/**
 * Cornerstone sizes every backing buffer as `clientSize * devicePixelRatio`
 * (truncated by the canvas IDL). A hidden canvas never needs a resize.
 */
export function canvasBufferNeedsResize(canvas: CanvasBox, pixelRatio: number) {
  if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return false;
  return (
    canvas.width !== Math.floor(canvas.clientWidth * pixelRatio) ||
    canvas.height !== Math.floor(canvas.clientHeight * pixelRatio)
  );
}

/**
 * The camera that shows, on an element of `nextSize`, exactly the frame an
 * element of `previousSize` showed. While a panel is dragged the old canvas is
 * scaled with object-fit: contain, so the frame shrinks or grows by the
 * smaller of the two size ratios; this converts that visible scale into an
 * absolute parallel scale (half the visible world height) for the new canvas.
 * Every other camera field is kept. Returns null when the input cannot be
 * converted.
 */
export function getCameraForResizedElement<
  Camera extends { parallelScale?: number },
>(
  camera: Camera | null | undefined,
  previousSize: ViewportSize | null | undefined,
  nextSize: ViewportSize
): Camera | null {
  const parallelScale = camera?.parallelScale;
  if (
    !camera ||
    !previousSize ||
    parallelScale == null ||
    !Number.isFinite(parallelScale) ||
    parallelScale <= 0 ||
    previousSize.width <= 0 ||
    previousSize.height <= 0
  ) {
    return null;
  }

  const widthRatio = nextSize.width / previousSize.width;
  const heightRatio = nextSize.height / previousSize.height;
  const visibleFrameScale = Math.min(widthRatio, heightRatio);
  if (!Number.isFinite(visibleFrameScale) || visibleFrameScale <= 0) return null;

  const nextParallelScale = (parallelScale * heightRatio) / visibleFrameScale;
  if (!Number.isFinite(nextParallelScale) || nextParallelScale <= 0) return null;

  return { ...camera, parallelScale: nextParallelScale };
}

/**
 * The camera that keeps the frame a stale canvas currently shows: its backing
 * buffer still has the old size (in device pixels) while its CSS box has the
 * new one. It depends on the buffer, not on the camera's history, so applying
 * it after any number of keep-camera engine resizes gives the same result.
 * Null when the buffer already matches the box.
 */
export function getCameraForStaleCanvas<
  Camera extends { parallelScale?: number },
>(
  camera: Camera | null | undefined,
  canvas: CanvasBox,
  pixelRatio: number
): Camera | null {
  if (!canvasBufferNeedsResize(canvas, pixelRatio)) return null;
  return getCameraForResizedElement(
    camera,
    { width: canvas.width / pixelRatio, height: canvas.height / pixelRatio },
    { width: canvas.clientWidth, height: canvas.clientHeight }
  );
}
