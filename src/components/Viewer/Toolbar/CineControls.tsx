'use client';
import React from 'react';
import { Button } from '@/components/ui/button';

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
  return (
    <div className="flex items-center gap-1 sm:gap-2 px-1 sm:px-2">
      {/* Play/Pause button */}
      <Button
        onClick={onTogglePlay}
        disabled={isLoading}
        className={`
          w-8 h-8 sm:w-10 sm:h-10 p-0 flex items-center justify-center
          border border-border rounded-md
          ${isActive ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground'}
          ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title={isLoading ? 'Loading…' : isPlaying ? 'Pause' : 'Play'}
      >
        <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`} />
      </Button>

      {/* FPS label */}
      <span className="text-xs sm:text-sm ml-1">{fps} fps</span>

      {/* Native range input for FPS */}
      <div className="flex items-center ml-2">
        <input
          type="range"
          min={1}
          max={60}
          step={1}
          value={fps}
          onChange={(e) => onFpsChange(Number(e.target.value))}
          className="w-16 sm:w-24 accent-primary cursor-pointer"
          title="Adjust playback speed (FPS)"
        />
      </div>
    </div>
  );
}
