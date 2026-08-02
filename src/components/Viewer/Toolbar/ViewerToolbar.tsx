// src/components/Viewer/Toolbar/ViewerToolbar.tsx
'use client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CirclePlay } from 'lucide-react';
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
import MeasurementToolsControl from './MeasurementToolsControl';
import ToolbarTooltip from './ToolbarTooltip';
import {
  getToolTooltip,
  MORE_TOOLS_TOOLTIP,
} from './tooltips';

interface ToolbarProps {
  activeTool: ToolID;
  onSelectTool: (tool: ToolID) => void;
  onReset: () => void;
  onRotate90: () => void;
  onFlipHorizontal: () => void;

  isCineOpen: boolean;
  onToggleCine: () => void;

  viewportEl?: HTMLDivElement | null;

  // NEW prop: whether current series is SR (read-only)
  isSeriesSR?: boolean;
}

export default function Toolbar({
  activeTool,
  onSelectTool,
  onReset,
  onRotate90,
  onFlipHorizontal,
  isCineOpen,
  onToggleCine,
  viewportEl,
  isSeriesSR = false,
}: ToolbarProps) {
  const renderButton = (tool: ToolID, iconClass: string, title: string) => {
    const isActive = activeTool === tool;
    const tooltip = getToolTooltip(tool, { label: title, detail: `${title} Tool` });
    return (
      <ToolbarTooltip label={tooltip.label} detail={tooltip.detail}>
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
          aria-label={`${tooltip.label} — ${tooltip.detail}`}
        >
          <i className={iconClass} />
        </Button>
      </ToolbarTooltip>
    );
  };

  const isOtherToolActive =
    activeTool === 'angle' ||
    activeTool === 'rotate90' ||
    activeTool === 'flipHorizontal' ||
    activeTool === 'reset';
  const isOtherControlActive = isCineOpen || isOtherToolActive;
  const otherIcon = isOtherToolActive ? getIconForOtherTool(activeTool) : 'tools';
  const otherTooltip = isCineOpen
    ? { label: 'Cine', detail: 'Cine Controls' }
    : isOtherToolActive
      ? getToolTooltip(activeTool, MORE_TOOLS_TOOLTIP)
      : MORE_TOOLS_TOOLTIP;

  return (
    <TooltipProvider>
      <div className="h-full overflow-x-auto">
        <div
          role="toolbar"
          aria-label="Công cụ xem ảnh DICOM"
          className="
            flex flex-nowrap justify-center items-center whitespace-nowrap
            h-full gap-1 sm:gap-2 px-2 py-0
            bg-card
          "
        >
          <MeasurementToolsControl
            activeTool={activeTool}
            onSelectTool={onSelectTool}
            readOnly={isSeriesSR}
          />

          {renderButton('zoom', 'fas fa-search-plus', 'Zoom')}
          {renderButton('pan', 'fas fa-arrows-alt', 'Pan')}
          {renderButton('adjust', 'fas fa-adjust', 'Adjust')}

          {/* CaptureControl */}
          <CaptureControl viewportEl={viewportEl ?? null} />

          {/* Other Tools Dropdown */}
          <DropdownMenu>
            <ToolbarTooltip label={otherTooltip.label} detail={otherTooltip.detail}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={isOtherControlActive ? 'default' : 'ghost'}
                  className="w-12 sm:w-14 h-8 sm:h-9 p-0 flex items-center justify-center border border-border rounded-md"
                  aria-label={`${otherTooltip.label} — ${otherTooltip.detail}`}
                  data-testid="other-tools-trigger"
                >
                  {isCineOpen ? (
                    <CirclePlay className="sm:mr-1" aria-hidden="true" />
                  ) : (
                    <i className={`fas fa-${otherIcon} sm:mr-1`} />
                  )}
                  <i className="fas fa-ellipsis-h hidden sm:inline" />
                </Button>
              </DropdownMenuTrigger>
            </ToolbarTooltip>
            <DropdownMenuContent className="z-[90] w-56 bg-card text-foreground border border-border">
              <DropdownMenuLabel>Other</DropdownMenuLabel>
              <DropdownMenuGroup>
                {/* Cine is a viewport state, not an active mouse tool. */}
                <DropdownMenuItem
                  onSelect={onToggleCine}
                  className={isCineOpen ? 'bg-muted text-foreground' : undefined}
                  aria-label={isCineOpen ? 'Đóng Cine' : 'Mở Cine'}
                >
                  <CirclePlay aria-hidden="true" /> Cine
                </DropdownMenuItem>

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
        </div>
      </div>
    </TooltipProvider>
  );
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
