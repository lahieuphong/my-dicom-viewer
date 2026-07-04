// src/components/Viewer/ViewportOverlay.tsx
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getEnabledElement, Enums as CoreEnums } from '@cornerstonejs/core';
import type { StackViewport } from '@cornerstonejs/core';
import { formatStudyDate } from '@/lib/utils';

type Props = {
  studyDate: string;
  viewportEl: HTMLDivElement | null;
  currentFrame?: number;
  totalFrames?: number;
};

type VoiRange = { lower: number; upper: number };
type VoiDetail = { range?: VoiRange };
type VoiEventLike = Event & { detail?: VoiDetail };

export default function ViewportOverlay({
  studyDate,
  viewportEl,
  currentFrame = 1,
  totalFrames = 0,
}: Props): React.ReactElement {
  const [windowWidth, setWindowWidth] = useState<number | null>(null);
  const [windowCenter, setWindowCenter] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  // Local "display" frame index that we update from multiple sources (prop, events, polling)
  const [displayFrame, setDisplayFrame] = useState<number>(currentFrame);
  const displayFrameRef = useRef<number>(displayFrame);

  // keep ref in sync whenever displayFrame changes
  useEffect(() => {
    displayFrameRef.current = displayFrame;
  }, [displayFrame]);

  const mountedRef = useRef(true);
  const rafIdRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<number | null>(null);

  // Safe event names
  const VOI_MODIFIED_EVENT =
    (CoreEnums && (CoreEnums as any).Events && (CoreEnums as any).Events.VOI_MODIFIED) ??
    'cornerstone-vm-voi-modified';
  const STACK_NEW_IMAGE_EVENT =
    (CoreEnums && (CoreEnums as any).Events && (CoreEnums as any).Events.STACK_NEW_IMAGE) ??
    'cornerstone-stack-new-image';

  const isValidVoi = (lower: any, upper: any) =>
    typeof lower === 'number' &&
    typeof upper === 'number' &&
    Number.isFinite(lower) &&
    Number.isFinite(upper) &&
    upper > lower;

  /* -------------------- Sync when parent prop changes (authoritative) -------------------- */
  useEffect(() => {
    const newVal = currentFrame ?? 1;
    // only update & log if changed
    if (displayFrameRef.current !== newVal) {
      setDisplayFrame(newVal);
      displayFrameRef.current = newVal;
      // TRACE log required by instructions
      try {
        // eslint-disable-next-line no-console
        console.debug('[TRACE ViewportOverlay] prop currentFrame ->', newVal, 'total', totalFrames);
      } catch {}
    }
  }, [currentFrame, totalFrames]);

  useEffect(() => {
    mountedRef.current = true;
    const currentEl = viewportEl;
    if (!currentEl) {
      return () => {
        mountedRef.current = false;
      };
    }

    /* -------------------- initial read: VOI + index -------------------- */
    try {
      const enabled = (() => {
        try {
          return getEnabledElement(currentEl);
        } catch {
          return null;
        }
      })();

      if (mountedRef.current && enabled) {
        try {
          const vp = enabled.viewport as StackViewport;
          const props: any = vp.getProperties?.();
          if (props?.voiRange) {
            const { lower, upper } = props.voiRange;
            if (isValidVoi(lower, upper)) {
              const newWW = upper - lower;
              const newWC = (upper + lower) / 2;
              setWindowWidth((prev) => (prev !== newWW ? newWW : prev));
              setWindowCenter((prev) => (prev !== newWC ? newWC : prev));
            }
          }

          // Try safe runtime calls for current index:
          try {
            const anyVp: any = vp as any;
            const idx =
              (typeof anyVp.getCurrentImageIdIndex === 'function' && anyVp.getCurrentImageIdIndex()) ??
              (typeof anyVp.getImageIdIndex === 'function' && anyVp.getImageIdIndex()) ??
              undefined;
            if (typeof idx === 'number' && !Number.isNaN(idx)) {
              const newVal = idx + 1;
              if (displayFrameRef.current !== newVal) {
                setDisplayFrame(newVal);
                displayFrameRef.current = newVal;
                try {
                  // TRACE log
                  // eslint-disable-next-line no-console
                  console.debug('[TRACE ViewportOverlay] initial read ->', newVal, 'total', totalFrames);
                } catch {}
              }
            }
          } catch {
            // ignore
          }
        } catch {
          // ignore
        }
      }
    } catch {}

    /* -------------------- VOI_MODIFIED listener -------------------- */
    const voiHandler = (evt: Event) => {
      const ev = evt as VoiEventLike;
      const range = ev?.detail?.range;
      if (range && isValidVoi(range.lower, range.upper)) {
        const newWW = range.upper - range.lower;
        const newWC = (range.upper + range.lower) / 2;
        setWindowWidth((prev) => (prev !== newWW ? newWW : prev));
        setWindowCenter((prev) => (prev !== newWC ? newWC : prev));
      }
    };

    try {
      currentEl.addEventListener(VOI_MODIFIED_EVENT, voiHandler as EventListener);
    } catch {}

    /* -------------------- STACK_NEW_IMAGE event listener -------------------- */
    const stackHandler = (e: any) => {
      try {
        const idx = typeof e?.detail?.imageIdIndex === 'number' ? e.detail.imageIdIndex : undefined;
        if (typeof idx === 'number' && !Number.isNaN(idx)) {
          const newVal = idx + 1;
          if (displayFrameRef.current !== newVal) {
            setDisplayFrame(newVal);
            displayFrameRef.current = newVal;
            try {
              // TRACE log required by instructions
              // eslint-disable-next-line no-console
              console.debug('[TRACE ViewportOverlay] stack new image index ->', newVal, 'total', totalFrames);
            } catch {}
          } else {
            // optionally log duplicates if needed for debug
            try {
              // eslint-disable-next-line no-console
              console.debug('[TRACE ViewportOverlay] stack event ignored (no change) ->', newVal, 'total', totalFrames);
            } catch {}
          }
        }
      } catch {}
    };

    try {
      currentEl.addEventListener(STACK_NEW_IMAGE_EVENT, stackHandler as EventListener);
    } catch {}

    /* -------------------- Poll zoom & fallback image index each frame -------------------- */
    const shouldPoll = () => {
      if (!mountedRef.current) return false;
      if (!currentEl) return false;
      if (typeof document !== 'undefined' && document.hidden) return false;
      if (!('isConnected' in currentEl) || (currentEl as any).isConnected === false) return false;
      try {
        if ((currentEl as HTMLElement).offsetParent === null && window.innerWidth < 768) {
          return false;
        }
      } catch {}
      return true;
    };

    const loop = () => {
      try {
        if (!shouldPoll()) {
          timeoutIdRef.current = window.setTimeout(() => {
            if (!mountedRef.current) return;
            loop();
          }, 500);
          return;
        }

        const en = (() => {
          try {
            return getEnabledElement(currentEl);
          } catch {
            return null;
          }
        })();

        if (en) {
          try {
            const vp = en.viewport as StackViewport;
            const anyVp: any = vp as any;

            // zoom
            const z = anyVp.getViewPresentation?.()?.zoom ?? null;
            setZoom((prev) => (prev !== z ? z : prev));

            // fallback: try multiple runtime getters for current image index
            try {
              let idx: number | undefined = undefined;
              if (typeof anyVp.getCurrentImageIdIndex === 'function') {
                const v = anyVp.getCurrentImageIdIndex();
                if (typeof v === 'number' && !Number.isNaN(v)) idx = v;
              } else if (typeof anyVp.getImageIdIndex === 'function') {
                const v2 = anyVp.getImageIdIndex();
                if (typeof v2 === 'number' && !Number.isNaN(v2)) idx = v2;
              } else {
                // last-resort: compare enabled.image.imageId against vp.getImageIds()
                try {
                  const ids = anyVp.getImageIds?.() ?? [];
                  const curId = (en as any).image?.imageId ?? null;
                  if (curId && Array.isArray(ids) && ids.length) {
                    const found = ids.findIndex((id: string) => String(id) === String(curId));
                    if (found >= 0) idx = found;
                  }
                } catch {}
              }

              if (typeof idx === 'number' && !Number.isNaN(idx)) {
                const newVal = idx + 1;
                if (displayFrameRef.current !== newVal) {
                  setDisplayFrame(newVal);
                  displayFrameRef.current = newVal;
                  try {
                    // TRACE log per instructions
                    // eslint-disable-next-line no-console
                    console.debug('[TRACE ViewportOverlay] poll ->', newVal, 'total', totalFrames);
                  } catch {}
                }
              }
            } catch {}
          } catch {
            // ignore runtime errors reading presentation
          }
        }
      } catch {}

      rafIdRef.current = requestAnimationFrame(loop);
    };

    loop();

    // resume polling when visibility changes
    const onVisibility = () => {
      if (!mountedRef.current) return;
      if (!document.hidden) {
        if (timeoutIdRef.current != null) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
        if (rafIdRef.current == null) {
          rafIdRef.current = requestAnimationFrame(loop);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // cleanup
    return () => {
      mountedRef.current = false;
      try {
        currentEl.removeEventListener(VOI_MODIFIED_EVENT, voiHandler as EventListener);
      } catch {}
      try {
        currentEl.removeEventListener(STACK_NEW_IMAGE_EVENT, stackHandler as EventListener);
      } catch {}
      document.removeEventListener('visibilitychange', onVisibility);
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (timeoutIdRef.current != null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, [viewportEl, VOI_MODIFIED_EVENT, STACK_NEW_IMAGE_EVENT, totalFrames]);

  const formattedDate = useMemo(() => formatStudyDate(studyDate), [studyDate]);

  const displayZoom = useMemo(() => {
    if (zoom == null) return 'N/A';
    if (Math.abs(zoom - 1) < 0.005) return '1.00×';
    return `${(Math.round(zoom * 100) / 100).toFixed(2)}×`;
  }, [zoom]);

  const panelClass = 'absolute px-2 py-1 rounded';
  const bg = 'bg-background dark:bg-background/50';
  const text = 'text-xs text-foreground';

  return (
    <>
      <div className={`${panelClass} top-2 left-2 ${bg} flex items-center space-x-1`}>
        <i className="fa-regular fa-calendar text-sm text-foreground" />
        <span className={text}>{formattedDate}</span>
      </div>

      <div className={`${panelClass} bottom-2 left-2 ${bg} flex items-center space-x-2`}>
        <span className={text}>W: {windowWidth != null ? windowWidth.toFixed(0) : 'N/A'}</span>
        <span className={text}>L: {windowCenter != null ? windowCenter.toFixed(0) : 'N/A'}</span>
        <i className="fa-solid fa-adjust text-sm text-foreground" />
      </div>

      <div className={`${panelClass} left-2 ${bg} flex items-center space-x-2`} style={{ bottom: '3.5rem' }}>
        <span className={text}>Zoom: {displayZoom}</span>
      </div>

      <div className={`${panelClass} bottom-2 right-2 ${bg} flex items-center space-x-1`}>
        <span className={text}>
          I:{' '}
          {totalFrames > 0 ? (
            <>
              {displayFrame} / {totalFrames}
            </>
          ) : (
            <>{displayFrame}</>
          )}
        </span>
      </div>
    </>
  );
}
