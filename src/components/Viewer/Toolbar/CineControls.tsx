'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pause,
  Play,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  CINE_FPS_UPDATE_DELAY_MS,
  clampCineFps,
  MAX_CINE_FPS,
  MIN_CINE_FPS,
} from '@/constants/cine';
import { cn } from '@/lib/utils';

import ToolbarTooltip from './ToolbarTooltip';
import { getCineTooltip, getFpsTooltip } from './tooltips';

interface CineControlsProps {
  open: boolean;
  isPlaying: boolean;
  fps: number;
  onPlayPauseChange: (isPlaying: boolean) => void;
  onFpsChange: (fps: number) => void;
  onClose: () => void;
  isLoading?: boolean;
  preparationPhase?: 'idle' | 'preparing' | 'ready' | 'error';
  preparationProgress?: number;
  preparedImages?: number;
  totalImages?: number;
  onRetryPreparation?: () => void;
  className?: string;
}

export default function CineControls({
  open,
  isPlaying,
  fps,
  onPlayPauseChange,
  onFpsChange,
  onClose,
  isLoading = false,
  preparationPhase = 'idle',
  preparationProgress = 0,
  preparedImages = 0,
  totalImages = 0,
  onRetryPreparation,
  className,
}: CineControlsProps) {
  const [displayFps, setDisplayFps] = useState(() => clampCineFps(fps));
  const [fpsPopoverOpen, setFpsPopoverOpen] = useState(false);
  const fpsUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFpsChangeRef = useRef(onFpsChange);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    onFpsChangeRef.current = onFpsChange;
  }, [onFpsChange]);

  useEffect(() => {
    setDisplayFps(clampCineFps(fps));
  }, [fps]);

  useEffect(() => {
    if (!open) {
      setFpsPopoverOpen(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (fpsUpdateTimerRef.current) {
        clearTimeout(fpsUpdateTimerRef.current);
      }
    };
  }, []);

  const preparationBusy =
    preparationPhase === 'idle' || preparationPhase === 'preparing';

  useEffect(() => {
    if (!open || !preparationBusy) return;

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, preparationBusy]);

  const updateFps = useCallback((nextValue: number) => {
    const nextFps = clampCineFps(nextValue);
    setDisplayFps(nextFps);

    if (fpsUpdateTimerRef.current) {
      clearTimeout(fpsUpdateTimerRef.current);
    }

    fpsUpdateTimerRef.current = setTimeout(() => {
      onFpsChangeRef.current(nextFps);
      fpsUpdateTimerRef.current = null;
    }, CINE_FPS_UPDATE_DELAY_MS);
  }, []);

  if (!open) return null;

  const isPreparing = preparationBusy;
  const hasPreparationError = preparationPhase === 'error';
  const playDisabled = isLoading || preparationPhase !== 'ready';
  const cineTooltip = hasPreparationError
    ? { label: 'Chưa thể phát chuỗi ảnh', detail: 'Cine preparation failed' }
    : getCineTooltip(isPlaying, playDisabled);
  const fpsTooltip = getFpsTooltip(displayFps);
  const safeProgress = Math.min(
    100,
    Math.max(0, Math.round(preparationProgress))
  );

  return (
    <TooltipProvider>
      <div
        data-testid="cine-player"
        role="region"
        aria-label="Điều khiển phát chuỗi ảnh Cine"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          'pointer-events-none absolute left-1/2 top-10 z-[60] -translate-x-1/2',
          className
        )}
      >
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {hasPreparationError
            ? 'Không thể chuẩn bị đủ ảnh cho Cine.'
            : isPreparing
              ? 'Đang chuẩn bị Cine. Các công cụ xem ảnh tạm thời bị khóa; bạn vẫn có thể chỉnh FPS hoặc đóng Cine.'
              : 'Cine đã sẵn sàng.'}
        </div>
        <div className="pointer-events-auto select-none rounded-lg border border-[#1e3a8a] bg-[#080b2e] p-2 text-white shadow-2xl">
          <div className="inline-flex items-center gap-2">
            <ToolbarTooltip
              label={cineTooltip.label}
              detail={cineTooltip.detail}
              wrapDisabledTrigger={playDisabled}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onPlayPauseChange(!isPlaying)}
                disabled={playDisabled}
                className="size-9 text-[#2f81f7] hover:bg-[#11184d] hover:text-[#60a5fa]"
                aria-label={`${cineTooltip.label} — ${cineTooltip.detail}`}
                data-testid="cine-play-pause"
              >
                {isPreparing || isLoading ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : isPlaying ? (
                  <Pause aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
              </Button>
            </ToolbarTooltip>

            <Popover open={fpsPopoverOpen} onOpenChange={setFpsPopoverOpen}>
              <div className="inline-flex h-9 items-center overflow-hidden rounded-md border border-[#1d4ed8] bg-[#050720]">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-none px-0 text-[#2f81f7] hover:bg-[#11184d] hover:text-[#60a5fa]"
                  onClick={() => updateFps(displayFps - 1)}
                  disabled={displayFps <= MIN_CINE_FPS}
                  aria-label="Giảm tốc độ Cine"
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>

                <ToolbarTooltip label={fpsTooltip.label} detail={fpsTooltip.detail}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-full min-w-[4.75rem] items-center justify-center gap-1 bg-transparent px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#2f81f7] focus-visible:ring-inset"
                      aria-label={`Điều chỉnh tốc độ Cine, hiện tại ${displayFps} FPS`}
                      aria-haspopup="dialog"
                    >
                      <span className="font-medium text-white">{displayFps}</span>
                      <span className="text-xs text-slate-300">FPS</span>
                    </button>
                  </PopoverTrigger>
                </ToolbarTooltip>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-none px-0 text-[#2f81f7] hover:bg-[#11184d] hover:text-[#60a5fa]"
                  onClick={() => updateFps(displayFps + 1)}
                  disabled={displayFps >= MAX_CINE_FPS}
                  aria-label="Tăng tốc độ Cine"
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>

              <PopoverContent
                side="bottom"
                align="center"
                sideOffset={8}
                className="z-[70] w-auto border-[#1e3a8a] bg-[#080b2e] p-3 text-white shadow-2xl"
                aria-label="Điều chỉnh tốc độ Cine"
              >
                <label className="flex items-center gap-3">
                  <span className="sr-only">Tốc độ phát Cine</span>
                  <input
                    type="range"
                    min={MIN_CINE_FPS}
                    max={MAX_CINE_FPS}
                    step={1}
                    value={displayFps}
                    onChange={(event) => updateFps(Number(event.target.value))}
                    className="w-40 cursor-pointer accent-[#2f81f7]"
                    aria-label="Tốc độ phát Cine"
                    aria-valuetext={`${displayFps} khung hình mỗi giây`}
                  />
                  <span className="min-w-14 text-right text-xs text-slate-300">
                    {displayFps} FPS
                  </span>
                </label>
              </PopoverContent>
            </Popover>

            <ToolbarTooltip label="Đóng Cine" detail="Close Cine">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                ref={closeButtonRef}
                className="size-9 text-[#2f81f7] hover:bg-[#11184d] hover:text-[#60a5fa]"
                aria-label="Đóng bảng điều khiển Cine"
                data-testid="cine-close"
              >
                <X aria-hidden="true" />
              </Button>
            </ToolbarTooltip>
          </div>

          {(isPreparing || isLoading) && (
            <div
              className="mt-2 min-w-[11.75rem] px-1"
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-slate-300">
                <span>Đang chuẩn bị Cine</span>
                <span className="tabular-nums">
                  {totalImages > 0
                    ? `${preparedImages}/${totalImages}`
                    : 'Đang tải…'}
                </span>
              </div>
              <div
                className="h-1 overflow-hidden rounded-full bg-[#1e293b]"
                role="progressbar"
                aria-label="Tiến độ chuẩn bị Cine"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={safeProgress}
                aria-valuetext={
                  totalImages > 0
                    ? `${preparedImages} trên ${totalImages} ảnh`
                    : 'Đang khởi tạo'
                }
              >
                <div
                  className="h-full rounded-full bg-[#2f81f7] transition-[width] duration-150 ease-out"
                  style={{ width: `${safeProgress}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-slate-400">
                Các công cụ xem ảnh đang tạm khóa.
              </p>
            </div>
          )}

          {hasPreparationError && (
            <div
              className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-amber-200"
              role="alert"
            >
              <span>Chưa nạp đủ chuỗi ảnh.</span>
              {onRetryPreparation && (
                <button
                  type="button"
                  className="rounded px-1.5 py-1 font-medium text-[#60a5fa] outline-none hover:bg-[#11184d] focus-visible:ring-2 focus-visible:ring-[#2f81f7]"
                  onClick={onRetryPreparation}
                >
                  Thử lại
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
