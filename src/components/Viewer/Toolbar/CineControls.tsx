'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import ToolbarTooltip from './ToolbarTooltip';
import { getCineTooltip, getFpsTooltip } from './tooltips';

interface CineControlsProps {
  isPlaying: boolean;
  fps: number;
  onTogglePlay: () => void;
  onFpsChange: (v: number) => void;
  isLoading?: boolean;
  isActive?: boolean;
}

export default function CineControls({
  isPlaying,
  fps,
  onTogglePlay,
  onFpsChange,
  isLoading = false,
  isActive = false,
}: CineControlsProps) {
  const cineTooltip = getCineTooltip(isPlaying, isLoading);
  const fpsTooltip = getFpsTooltip(fps);

  return (
    <div className="flex items-center gap-1 sm:gap-2 px-1 sm:px-2">
      {/* Play/Pause button */}
      <ToolbarTooltip
        label={cineTooltip.label}
        detail={cineTooltip.detail}
        wrapDisabledTrigger={isLoading}
      >
        <Button
          onClick={onTogglePlay}
          disabled={isLoading}
          className={`
            w-8 h-8 sm:w-9 sm:h-9 p-0 flex items-center justify-center
            border border-border rounded-md
            ${isActive ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground'}
            ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          aria-label={`${cineTooltip.label} — ${cineTooltip.detail}`}
        >
          <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`} />
        </Button>
      </ToolbarTooltip>

      {/* FPS label */}
      <span className="text-xs sm:text-sm ml-1">{fps} fps</span>

      {/* Native range input for FPS */}
      <div className="flex items-center ml-2">
        <ToolbarTooltip label={fpsTooltip.label} detail={fpsTooltip.detail}>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={fps}
            onChange={(e) => onFpsChange(Number(e.target.value))}
            className="w-16 sm:w-24 accent-primary cursor-pointer"
            aria-label="Tốc độ phát Cine"
            aria-valuetext={`${fps} khung hình mỗi giây`}
          />
        </ToolbarTooltip>
      </div>
    </div>
  );
}
