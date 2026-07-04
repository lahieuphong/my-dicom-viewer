// src/components/Viewer/ViewportLoadingOverlay.tsx
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

  const displayProgress = clamp(Math.round(internalProgress));

  return (
    <div
      className={`absolute inset-0 z-40 flex items-center justify-center pointer-events-none ${className}`}
      aria-hidden={!visible}
    >
      <div className="pointer-events-auto bg-card/90 p-4 rounded shadow-lg w-[min(95%,520px)]">
        <div className="flex items-center space-x-3">
          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div
                  className="w-full bg-border rounded-full h-2 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={displayProgress}
                  aria-label="Image loading progress"
                >
                  <div
                    style={{
                      width: `${displayProgress}%`,
                      transition: `width ${transitionMs}ms linear`,
                    }}
                    className="h-2 rounded-full bg-gradient-to-r from-primary to-primary/80"
                  />
                </div>
              </div>

              {showPercent && (
                <div className="text-xs font-medium tabular-nums w-12 text-right">
                  {displayProgress}%
                </div>
              )}
            </div>

            {/* optional small caption */}
            <div className="mt-2 text-xs text-muted-foreground">
              {displayProgress < 100 ? 'Đang nạp hình — vui lòng chờ' : 'Hoàn tất'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
