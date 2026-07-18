// src/components/Viewer/Toolbar/ViewerToolbar.tsx
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import { ToolID } from '@/hooks/useToolManager';

import CaptureControl from './CaptureControl';
import CineControls from './CineControls';

interface ToolbarProps {
  activeTool: ToolID;
  onSelectTool: (tool: ToolID) => void;
  onReset: () => void;
  onRotate90: () => void;
  onFlipHorizontal: () => void;

  isPlaying: boolean;
  fps: number;
  onTogglePlay: () => void;
  onFpsChange: (v: number) => void;
  isLoading: boolean;

  viewportEl?: HTMLDivElement | null;

  // NEW prop: whether current series is SR (read-only)
  isSeriesSR?: boolean;
}

const measurementTools: ToolID[] = [
  'length',
  'bidirectional',
  'arrowAnnotate',
  'ellipticalROI',
  'rectangleROI',
  'circleROI',
  'splineROI',
];

export default function Toolbar({
  activeTool,
  onSelectTool,
  onReset,
  onRotate90,
  onFlipHorizontal,
  isPlaying,
  fps,
  onTogglePlay,
  onFpsChange,
  isLoading,
  viewportEl,
  isSeriesSR = false,
}: ToolbarProps) {
  const renderButton = (tool: ToolID, iconClass: string, title: string) => {
    const isActive = activeTool === tool;
    return (
      <Button
        onClick={() => onSelectTool(tool)}
        variant={isActive ? 'default' : 'ghost'}
        className={`
          w-8 h-8 sm:w-9 sm:h-9 p-0 flex items-center justify-center
          border border-border rounded-md
          ${isActive
            ? 'bg-primary text-primary-foreground'
            : 'bg-transparent text-foreground'}
        `}
        title={title}
      >
        <i className={iconClass} />
      </Button>
    );
  };

  const isMeasurementActive = measurementTools.includes(activeTool);
  const isOtherToolActive =
    activeTool === 'angle' ||
    activeTool === 'rotate90' ||
    activeTool === 'flipHorizontal' ||
    activeTool === 'reset';
  const isCineActive = activeTool === 'cine';

  const measurementIcon = isMeasurementActive ? getIconForTool(activeTool) : 'ruler';
  const otherIcon = isOtherToolActive ? getIconForOtherTool(activeTool) : 'tools';

  return (
    <div className="h-full overflow-x-auto">
      <div
        className="
          flex flex-nowrap justify-center items-center whitespace-nowrap
          h-full gap-1 sm:gap-2 px-2 py-0
          bg-card
        "
      >
        {renderButton('adjust', 'fas fa-adjust', 'Adjust')}
        {renderButton('pan', 'fas fa-arrows-alt', 'Pan')}
        {renderButton('zoom', 'fas fa-search-plus', 'Zoom')}

        {/* Cine Controls */}
        <CineControls
          isPlaying={isPlaying}
          fps={fps}
          onTogglePlay={() => {
            onTogglePlay();
            onSelectTool('cine');
          }}
          onFpsChange={onFpsChange}
          isLoading={isLoading}
          isActive={isCineActive}
        />

        {/* Measurement Tools Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={isMeasurementActive ? 'default' : 'ghost'}
              className="w-12 sm:w-14 h-8 sm:h-9 p-0 flex items-center justify-center border border-border rounded-md"
              title="Measurement tools"
            >
              <i className={`fas fa-${measurementIcon} sm:mr-1`} />
              <i className="fas fa-ellipsis-h hidden sm:inline" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent className="w-56 bg-card text-foreground border border-border">
            <DropdownMenuLabel>Công cụ đo lường</DropdownMenuLabel>
            <DropdownMenuGroup>
              {measurementTools.map((tool) => {
                const disabled = isSeriesSR;
                return (
                  <DropdownMenuItem
                    key={tool}
                    onClick={(e) => {
                      if (disabled) {
                        e.stopPropagation();
                        return;
                      }
                      onSelectTool(tool);
                    }}
                    className={`w-full text-left flex items-center px-2 py-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'}`}
                    aria-disabled={disabled}
                  >
                    <i className={`fas fa-${getIconForTool(tool)} mr-2`} />
                    <span className="capitalize">{tool}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Other Tools Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={isOtherToolActive ? 'default' : 'ghost'}
              className="w-12 sm:w-14 h-8 sm:h-9 p-0 flex items-center justify-center border border-border rounded-md"
              title="Other tools"
            >
              <i className={`fas fa-${otherIcon} sm:mr-1`} />
              <i className="fas fa-ellipsis-h hidden sm:inline" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 bg-card text-foreground border border-border">
            <DropdownMenuLabel>Other</DropdownMenuLabel>
            <DropdownMenuGroup>
              {/* Angle Tool */}
              <DropdownMenuItem
                onClick={(e) => {
                  if (isSeriesSR) {
                    e.stopPropagation();
                    return;
                  }
                  onSelectTool('angle');
                }}
                className={`w-full text-left flex items-center px-2 py-2 ${isSeriesSR ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'}`}
                aria-disabled={isSeriesSR}
              >
                <i className="fas fa-angle-right mr-2" /> Angle
              </DropdownMenuItem>

              {/* Rotate 90° */}
              <DropdownMenuItem
                onClick={() => {
                  onRotate90();
                  onSelectTool('rotate90');
                }}
              >
                <i className="fas fa-sync-alt mr-2" /> Rotate 90°
              </DropdownMenuItem>

              {/* Flip Horizontal */}
              <DropdownMenuItem
                onClick={() => {
                  onFlipHorizontal();
                  onSelectTool('flipHorizontal');
                }}
              >
                <i className="fas fa-arrows-h mr-2" /> Flip Horizontal
              </DropdownMenuItem>

              {/* Reset */}
              <DropdownMenuItem
                onClick={() => {
                  onReset();
                  onSelectTool('reset');
                }}
              >
                <i className="fas fa-redo mr-2" /> Reset View
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* CaptureControl */}
        <CaptureControl viewportEl={viewportEl ?? null} />
      </div>
    </div>
  );
}

function getIconForTool(tool: ToolID) {
  switch (tool) {
    case 'length':
      return 'ruler';
    case 'bidirectional':
      return 'arrows-alt-h';
    case 'arrowAnnotate':
      return 'long-arrow-alt-right';
    case 'ellipticalROI':
      return 'comment';
    case 'rectangleROI':
      return 'square';
    case 'circleROI':
      return 'circle';
    case 'splineROI':
      return 'ruler-combined';
    default:
      return 'question';
  }
}

function getIconForOtherTool(tool: ToolID) {
  switch (tool) {
    case 'angle':
      return 'angle-right';
    case 'rotate90':
      return 'sync-alt';
    case 'flipHorizontal':
      return 'arrows-h';
    case 'reset':
      return 'redo';
    default:
      return 'tools';
  }
}
