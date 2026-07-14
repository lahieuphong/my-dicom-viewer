// src/components/Viewer/Viewport/ViewportOverlay.tsx
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Enums as CoreEnums, getEnabledElement, metaData } from '@cornerstonejs/core';
import type { StackViewport } from '@cornerstonejs/core';
import { utilities as csToolsUtilities } from '@cornerstonejs/tools';
import { formatStudyDate } from '@/lib/utils';

type Props = {
  studyDate: string;
  seriesDescription?: string;
  viewportEl: HTMLDivElement | null;
  currentFrame?: number;
  totalFrames?: number;
};

type VoiRange = { lower: number; upper: number };
type VoiDetail = { range?: VoiRange };
type VoiEventLike = Event & { detail?: VoiDetail };
type OrientationMarkers = { top: string; left: string };
type OverlayIconProps = { className?: string };

const EMPTY_ORIENTATION: OrientationMarkers = { top: '', left: '' };
const STACK_EVENT_GRACE_MS = 650;

function OrientationSwitchIcon({ className = '' }: OverlayIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.57766 17.4182L9.4655 19.8288L6.80457 21.4557"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.5918 15C19.8503 15.1669 20.067 15.3909 20.2253 15.6547C20.3836 15.9186 20.4793 16.2152 20.5049 16.5218C20.5049 18.3123 16.991 19.7938 12.5153 19.946"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.46782 19.828C5.73931 19.4354 3 18.1038 3 16.5218C3.02464 16.2179 3.11841 15.9236 3.27416 15.6614C3.4299 15.3992 3.6435 15.1761 3.89865 15.0091"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.60608 15.1079C8.10461 15.1079 7.78088 14.8159 7.78088 14.3525C7.78088 14.2256 7.81262 14.0479 7.88879 13.8511L10.5485 6.62109C10.7706 6.01172 11.1388 5.73242 11.7355 5.73242C12.3385 5.73242 12.7067 5.99902 12.9352 6.61475L15.6012 13.8511C15.6774 14.0605 15.7091 14.2065 15.7091 14.3525C15.7091 14.7969 15.3663 15.1079 14.8903 15.1079C14.4459 15.1079 14.1984 14.9048 14.0524 14.416L13.4493 12.6641H10.028L9.42493 14.4033C9.27258 14.8984 9.03137 15.1079 8.60608 15.1079ZM10.4152 11.3691H13.0494L11.7482 7.45898H11.7037L10.4152 11.3691Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ViewportViewsIcon({ className = '' }: OverlayIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12.1675 14.7545C12.0607 14.8152 11.9393 14.8152 11.8325 14.7545L3.25173 9.89965C3.09887 9.81314 3 9.6169 3 9.4C3 9.1831 3.09887 8.98686 3.25173 8.90035L11.8325 4.04549C11.9393 3.98484 12.0607 3.98484 12.1675 4.04549L20.7483 8.90035C20.9011 8.98686 21 9.1831 21 9.4C21 9.6169 20.9011 9.81314 20.7483 9.89965L12.1675 14.7545Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.7793 12.1L20.7483 14.3367C20.9011 14.4227 21 14.6178 21 14.8333C21 15.0489 20.9011 15.2439 20.7483 15.3299L12.1675 20.1548C12.0607 20.2151 11.9393 20.2151 11.8325 20.1548L3.25173 15.3299C3.09887 15.2439 3 15.0489 3 14.8333C3 14.6178 3.09887 14.4227 3.25173 14.3367L7.20181 12.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ViewportWindowLevelIcon({ className = '' }: OverlayIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(4 4)" fill="currentColor">
        <path d="M8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16C12.4183 16 16 12.4183 16 8C16 3.58172 12.4183 0 8 0ZM8 1.01463C11.8579 1.01463 14.9854 4.14209 14.9854 8C14.9854 11.8579 11.8579 14.9854 8 14.9854C4.14209 14.9854 1.01463 11.8579 1.01463 8C1.01463 4.14209 4.14209 1.01463 8 1.01463Z" />
        <path d="M13.9802 2.99802C15.2351 4.37869 16 6.21292 16 8.22583C16 12.5194 12.52 16 8.22722 16C6.21467 16 4.38077 15.235 3.00035 13.9798C3.38388 13.5964 3.81184 13.1684 4.28335 12.6968L4.86417 12.1159C5.13143 11.8485 5.41084 11.5691 5.70239 11.2775L7.59748 9.38206C8.61791 8.36144 9.74768 7.23147 10.9868 5.99215L13.9802 2.99802Z" />
      </g>
    </svg>
  );
}

function subtractPoint(a: number[], b: number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function readOrientationMarkers(
  viewport: StackViewport,
  element: HTMLDivElement
): OrientationMarkers {
  try {
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width <= 1 || height <= 1) return EMPTY_ORIENTATION;

    const center = viewport.canvasToWorld([width / 2, height / 2]);
    const top = viewport.canvasToWorld([width / 2, height / 2 - 1]);
    const left = viewport.canvasToWorld([width / 2 - 1, height / 2]);
    const getOrientationString = csToolsUtilities.orientation.getOrientationStringLPS;

    return {
      top: getOrientationString(subtractPoint(top, center)),
      left: getOrientationString(subtractPoint(left, center)),
    };
  } catch {
    return EMPTY_ORIENTATION;
  }
}

function readInstanceNumber(viewport: StackViewport): number | null {
  try {
    const imageId = viewport.getCurrentImageId?.();
    if (!imageId) return null;

    const imageMetadata = metaData.get('generalImageModule', imageId) as
      | { instanceNumber?: number | string | null }
      | undefined;
    const rawValue = imageMetadata?.instanceNumber;
    if (rawValue == null || rawValue === '') return null;

    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export default function ViewportOverlay({
  studyDate,
  seriesDescription = '',
  viewportEl,
  currentFrame = 1,
  totalFrames = 0,
}: Props): React.ReactElement {
  const [windowWidth, setWindowWidth] = useState<number | null>(null);
  const [windowCenter, setWindowCenter] = useState<number | null>(null);
  const [instanceNumber, setInstanceNumber] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<OrientationMarkers>(EMPTY_ORIENTATION);

  // Local "display" frame index that we update from multiple sources (prop, events, polling)
  const [displayFrame, setDisplayFrame] = useState<number>(currentFrame);
  const displayFrameRef = useRef<number>(displayFrame);

  // keep ref in sync whenever displayFrame changes
  useEffect(() => {
    displayFrameRef.current = displayFrame;
  }, [displayFrame]);

  const mountedRef = useRef(true);
  const pollTimerRef = useRef<number | null>(null);
  const lastStackEventAtRef = useRef(0);

  // Safe event names
  const VOI_MODIFIED_EVENT =
    (CoreEnums && (CoreEnums as any).Events && (CoreEnums as any).Events.VOI_MODIFIED) ??
    'cornerstone-vm-voi-modified';
  const STACK_NEW_IMAGE_EVENT =
    (CoreEnums && (CoreEnums as any).Events && (CoreEnums as any).Events.STACK_NEW_IMAGE) ??
    'cornerstone-stack-new-image';
  const CAMERA_MODIFIED_EVENT =
    (CoreEnums && (CoreEnums as any).Events && (CoreEnums as any).Events.CAMERA_MODIFIED) ??
    'cornerstone-camera-modified';

  const isValidVoi = (lower: any, upper: any) =>
    typeof lower === 'number' &&
    typeof upper === 'number' &&
    Number.isFinite(lower) &&
    Number.isFinite(upper) &&
    upper > lower;

  /* -------------------- Sync when parent prop changes (authoritative) -------------------- */
  useEffect(() => {
    let timer: number | null = null;

    const syncFromParentWhenIdle = () => {
      const idleFor = Date.now() - lastStackEventAtRef.current;
      if (lastStackEventAtRef.current > 0 && idleFor < STACK_EVENT_GRACE_MS) {
        timer = window.setTimeout(syncFromParentWhenIdle, STACK_EVENT_GRACE_MS - idleFor);
        return;
      }

      const newVal = currentFrame ?? 1;
      if (displayFrameRef.current !== newVal) {
        setDisplayFrame(newVal);
        displayFrameRef.current = newVal;
      }
    };

    syncFromParentWhenIdle();
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [currentFrame]);

  useEffect(() => {
    mountedRef.current = true;
    const currentEl = viewportEl;
    if (!currentEl) {
      return () => {
        mountedRef.current = false;
      };
    }

    const syncInstanceNumber = (viewport: StackViewport) => {
      const nextInstanceNumber = readInstanceNumber(viewport);
      setInstanceNumber((previous) =>
        previous === nextInstanceNumber ? previous : nextInstanceNumber
      );
    };

    const syncOrientationMarkers = (viewport: StackViewport) => {
      const nextOrientation = readOrientationMarkers(viewport, currentEl);
      setOrientation((previous) =>
        previous.top === nextOrientation.top && previous.left === nextOrientation.left
          ? previous
          : nextOrientation
      );
    };

    /* -------------------- initial read: VOI + image details -------------------- */
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
          syncInstanceNumber(vp);
          syncOrientationMarkers(vp);
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
        lastStackEventAtRef.current = Date.now();
        const idx = typeof e?.detail?.imageIdIndex === 'number' ? e.detail.imageIdIndex : undefined;
        if (typeof idx === 'number' && !Number.isNaN(idx)) {
          const newVal = idx + 1;
          if (displayFrameRef.current !== newVal) {
            setDisplayFrame(newVal);
            displayFrameRef.current = newVal;
          }
        }

        const enabled = getEnabledElement(currentEl);
        if (enabled) syncInstanceNumber(enabled.viewport as StackViewport);
      } catch {}
    };

    try {
      currentEl.addEventListener(STACK_NEW_IMAGE_EVENT, stackHandler as EventListener);
    } catch {}

    const cameraHandler = () => {
      try {
        const enabled = getEnabledElement(currentEl);
        if (enabled) syncOrientationMarkers(enabled.viewport as StackViewport);
      } catch {}
    };

    try {
      currentEl.addEventListener(CAMERA_MODIFIED_EVENT, cameraHandler as EventListener);
    } catch {}

    /* -------------------- Low-frequency fallback when stack events are unavailable -------------------- */
    const pollIntervalMs = 400;

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

    const schedulePoll = (delay = pollIntervalMs) => {
      if (!mountedRef.current || pollTimerRef.current != null) return;
      pollTimerRef.current = window.setTimeout(poll, delay);
    };

    const poll = () => {
      pollTimerRef.current = null;
      try {
        if (!shouldPoll()) {
          schedulePoll(800);
          return;
        }

        // STACK_NEW_IMAGE is authoritative and already keeps the overlay in sync.
        // Avoid duplicate metadata reads while wheel/Cine events are flowing.
        if (Date.now() - lastStackEventAtRef.current < STACK_EVENT_GRACE_MS) {
          schedulePoll();
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
            syncInstanceNumber(vp);

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
                }
              }
            } catch {}
          } catch {
            // ignore runtime errors reading presentation
          }
        }
      } catch {}

      schedulePoll();
    };

    schedulePoll();

    // resume polling when visibility changes
    const onVisibility = () => {
      if (!mountedRef.current) return;
      if (!document.hidden) {
        if (pollTimerRef.current != null) window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
        schedulePoll(0);
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
      try {
        currentEl.removeEventListener(CAMERA_MODIFIED_EVENT, cameraHandler as EventListener);
      } catch {}
      document.removeEventListener('visibilitychange', onVisibility);
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [
    viewportEl,
    VOI_MODIFIED_EVENT,
    STACK_NEW_IMAGE_EVENT,
    CAMERA_MODIFIED_EVENT,
    totalFrames,
  ]);

  const formattedDate = useMemo(() => formatStudyDate(studyDate), [studyDate]);
  const displayedInstanceNumber = instanceNumber ?? displayFrame;
  const overlayClass = 'pointer-events-none absolute z-10 select-none';
  const textClass =
    'text-sm font-medium leading-5 text-muted-foreground dark:text-blue-200/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.95)]';
  const markerClass =
    'text-xs font-semibold text-muted-foreground dark:text-blue-200/65 [text-shadow:0_1px_2px_rgb(0_0_0/0.95)]';
  const iconClass = 'text-[#348cfd]';

  return (
    <>
      <div className={`${overlayClass} left-2 top-3`}>
        <div className={`flex h-5 items-center gap-0 ${iconClass}`}>
          <OrientationSwitchIcon className="size-5 shrink-0" />
          <ViewportViewsIcon className="size-5 shrink-0" />
        </div>

        <div className={`mt-1 ${textClass}`}>
          <div>{formattedDate}</div>
          {seriesDescription && (
            <div className="max-w-[min(42vw,24rem)] truncate">{seriesDescription}</div>
          )}
        </div>
      </div>

      {orientation.top && (
        <div className={`${overlayClass} ${markerClass} left-1/2 top-3 -translate-x-1/2`}>
          {orientation.top}
        </div>
      )}

      {orientation.left && (
        <div className={`${overlayClass} ${markerClass} left-2 top-1/2 -translate-y-1/2`}>
          {orientation.left}
        </div>
      )}

      <div className={`${overlayClass} bottom-3 left-2 ${textClass}`}>
        <div className="flex items-center gap-2 tabular-nums">
          <span>W: {windowWidth != null ? windowWidth.toFixed(0) : 'N/A'}</span>
          <span>L: {windowCenter != null ? windowCenter.toFixed(0) : 'N/A'}</span>
        </div>
        <ViewportWindowLevelIcon className={`mt-1 size-5 ${iconClass}`} />
      </div>

      <div
        className={`${overlayClass} bottom-3 right-4 flex items-baseline gap-1 ${textClass} tabular-nums`}
      >
        <span>I:</span>
        <span>{displayedInstanceNumber}</span>
        {totalFrames > 0 && <span>({displayFrame}/{totalFrames})</span>}
      </div>
    </>
  );
}
