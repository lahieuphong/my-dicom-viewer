// src/components/Viewer/Viewport/ViewportLoadingOverlay.tsx
'use client';
import React, { useEffect, useRef, useState } from 'react';

export interface ViewportLoadingOverlayProps {
  visible: boolean;
  /**
   * Nếu truyền giá trị (0..100) thì overlay sẽ hiển thị determinisitc progress bar.
   * Nếu không truyền (undefined/null) thì component sẽ tự simulate progress (1 -> 95%)
   * cho đến khi visible = false, khi đó nó sẽ nhảy lên 100% rồi ẩn.
   */
  progress?: number | null;
  /**
   * Có hiển thị phần trăm dạng text ở cạnh phải bar không. Mặc định true.
   */
  showPercent?: boolean;
  /**
   * Class thêm vào wrapper để tuỳ chỉnh style từ ngoài.
   */
  className?: string;
  /**
   * Thời gian (ms) cho animation fill -> dùng CSS transition nội bộ.
   */
  transitionMs?: number;
}

function HvttLoadingLogo(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      className="h-full w-full overflow-visible drop-shadow-[0_0_18px_rgba(91,215,240,0.22)]"
    >
      <style>
        {`
          .hvtt-loading-logo__disc {
            animation: hvttLogoBreathe 2.4s ease-in-out infinite;
            transform-origin: 60px 60px;
          }

          .hvtt-loading-logo__ring {
            animation: hvttLogoRing 2.4s ease-in-out infinite;
            stroke-dasharray: 315;
            stroke-dashoffset: 0;
            transform-origin: 60px 60px;
          }

          .hvtt-loading-logo__swoosh {
            animation: hvttLogoSwoosh 2.4s ease-in-out infinite;
          }

          @keyframes hvttLogoBreathe {
            0%, 100% { transform: scale(1); opacity: 0.96; }
            50% { transform: scale(1.035); opacity: 1; }
          }

          @keyframes hvttLogoRing {
            0%, 100% { stroke-dashoffset: 0; opacity: 0.7; }
            50% { stroke-dashoffset: -18; opacity: 1; }
          }

          @keyframes hvttLogoSwoosh {
            0%, 100% { opacity: 0.88; }
            50% { opacity: 1; }
          }
        `}
      </style>

      <defs>
        <linearGradient id="hvttLoadingBlue" x1="18" y1="95" x2="104" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0599d1" />
          <stop offset="0.55" stopColor="#5bd7f0" />
          <stop offset="1" stopColor="#0c8ed0" />
        </linearGradient>
        <linearGradient id="hvttLoadingSoftBlue" x1="14" y1="89" x2="108" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#27b5e4" />
          <stop offset="1" stopColor="#7fdcf6" />
        </linearGradient>
      </defs>

      <g className="hvtt-loading-logo__disc">
        <circle cx="60" cy="60" r="53" fill="#f8fdff" />
        <circle
          className="hvtt-loading-logo__ring"
          cx="60"
          cy="60"
          r="53"
          fill="none"
          stroke="#73d4f4"
          strokeWidth="1.5"
        />

        <path
          className="hvtt-loading-logo__swoosh"
          d="M9 72C28 63 44 44 62 12C47 29 34 43 20 51C34 46 47 35 65 18C51 44 34 65 9 72Z"
          fill="url(#hvttLoadingBlue)"
        />
        <path
          className="hvtt-loading-logo__swoosh"
          d="M111 48C92 57 76 76 58 108C73 91 86 77 100 69C86 74 73 85 55 102C69 76 86 55 111 48Z"
          fill="url(#hvttLoadingBlue)"
        />
        <path
          d="M25 88C39 83 51 74 64 61C54 77 44 91 30 101C46 94 60 82 78 62C65 86 48 101 25 108C29 101 29 95 25 88Z"
          fill="url(#hvttLoadingSoftBlue)"
          opacity="0.84"
        />
        <path
          d="M95 32C81 37 69 46 56 59C66 43 76 29 90 19C74 26 60 38 42 58C55 34 72 19 95 12C91 19 91 25 95 32Z"
          fill="url(#hvttLoadingSoftBlue)"
          opacity="0.84"
        />

        <g transform="rotate(-35 60 60)">
          <text
            x="34"
            y="60"
            fill="#ef3348"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="18"
            fontWeight="800"
            letterSpacing="1.2"
          >
            HVTT
          </text>
          <text
            x="48"
            y="77"
            fill="#19aee4"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="11"
            fontWeight="600"
            letterSpacing="0.8"
          >
            Software
          </text>
        </g>
      </g>
    </svg>
  );
}

export default function ViewportLoadingOverlay({
  visible,
  progress = null,
  showPercent = true,
  className = '',
  transitionMs = 300,
}: ViewportLoadingOverlayProps): React.ReactElement | null {
  const [internalProgress, setInternalProgress] = useState<number>(0);
  const simulationRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const lastVisibleRef = useRef<boolean>(false);

  // clamp helper
  const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));

  // If external progress provided, reflect it immediately
  useEffect(() => {
    if (typeof progress === 'number' && !Number.isNaN(progress)) {
      setInternalProgress(clamp(Math.round(progress)));
    }
  }, [progress]);

  // Simulation logic when progress not externally provided
  useEffect(() => {
    // only simulate when external progress is not provided
    if (typeof progress === 'number') {
      // cancel any simulation if controlled externally
      if (simulationRef.current) {
        window.clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      return;
    }

    // When visible turns true: start at 1 and slowly increment to a soft cap (95)
    if (visible) {
      lastVisibleRef.current = true;
      // ensure progress starts near 1 when becoming visible
      setInternalProgress((p) => (p > 0 ? p : 1));

      // clear any previous simulation
      if (simulationRef.current) {
        window.clearInterval(simulationRef.current);
        simulationRef.current = null;
      }

      // progressive increment: larger steps early, smaller when approaching cap
      simulationRef.current = window.setInterval(() => {
        setInternalProgress((cur) => {
          const cap = 95;
          if (cur >= cap) return cur;
          // step size decreases as cur approaches cap
          const remaining = cap - cur;
          // heuristic step: larger when small cur, tiny when close
          const step = Math.max(0.5, Math.min(6, remaining * 0.06 + (cur < 10 ? 0.6 : 0)));
          const next = Math.round((cur + step) * 10) / 10;
          return clamp(next, 0, cap);
        });
      }, 300);
    } else {
      // visible turned false:
      // - clear periodic increment
      if (simulationRef.current) {
        window.clearInterval(simulationRef.current);
        simulationRef.current = null;
      }

      // if we were visible before, animate to 100% then hide after short delay
      if (lastVisibleRef.current) {
        setInternalProgress(100);
        lastVisibleRef.current = false;

        if (hideTimeoutRef.current) {
          window.clearTimeout(hideTimeoutRef.current);
          hideTimeoutRef.current = null;
        }
        // keep overlay visible a little while so user sees 100%
        hideTimeoutRef.current = window.setTimeout(() => {
          // hide by setting to 0 (when overlay not visible component returns null)
          setInternalProgress(0);
          hideTimeoutRef.current = null;
        }, 350);
      } else {
        // ensure reset
        setInternalProgress(0);
      }
    }

    return () => {
      if (simulationRef.current) {
        window.clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (simulationRef.current) {
        window.clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, []);

  // Determine whether to render overlay:
  // show when visible === true OR when we are showing final 100% (internalProgress === 100)
  const shouldShow = visible || internalProgress > 0;

  if (!shouldShow) return null;

  const displayProgress = clamp(Math.max(1, Math.round(internalProgress)), 1, 100);
  const progressText = `${displayProgress}%`;

  return (
    <>
      <div
        className="fixed inset-0 z-[45] pointer-events-none bg-black/45 backdrop-blur-[5px] backdrop-saturate-50"
        aria-hidden="true"
      />

      <div
        className={`absolute inset-0 z-[46] flex items-center justify-center bg-black/78 pointer-events-none ${className}`}
        aria-hidden={!visible}
      >
        <div className="flex w-[min(70vw,340px)] -translate-y-8 flex-col items-center gap-7">
          <div className="relative flex h-[88px] w-[88px] items-center justify-center">
            <HvttLoadingLogo />
          </div>

          <div className="w-full">
            <div className="flex items-center gap-4">
              <div
                className="h-[9px] flex-1 overflow-hidden rounded-full bg-[#062052]"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={100}
                aria-valuenow={displayProgress}
                aria-label="Image loading progress"
              >
                <div
                  style={{
                    width: `${displayProgress}%`,
                    transition: `width ${transitionMs}ms linear`,
                  }}
                  className="h-full rounded-full bg-[#5bd7f0] shadow-[0_0_14px_rgba(91,215,240,0.45)]"
                />
              </div>

              {showPercent && (
                <div className="w-12 text-right text-sm font-semibold leading-none text-slate-100 tabular-nums">
                  {progressText}
                </div>
              )}
            </div>

            <span className="sr-only">
              {displayProgress < 100 ? `Đang nạp hình ${progressText}` : 'Hoàn tất'}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
