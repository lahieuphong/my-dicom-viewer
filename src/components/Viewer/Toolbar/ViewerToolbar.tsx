// src/components/Viewer/Toolbar/ViewerToolbar.tsx
'use client';
import { useState } from 'react';
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
  onCloseCine: () => void;

  viewportEl?: HTMLDivElement | null;

  // NEW prop: whether current series is SR (read-only)
  isSeriesSR?: boolean;
  disabled?: boolean;
}

const OTHER_TOOL_IDS = [
  'angle',
  'rotate90',
  'flipHorizontal',
  'reset',
] as const satisfies readonly ToolID[];

type OtherToolID = (typeof OTHER_TOOL_IDS)[number];
type OtherItemID = OtherToolID | 'cine';

function isOtherTool(tool: ToolID): tool is OtherToolID {
  return (OTHER_TOOL_IDS as readonly ToolID[]).includes(tool);
}

function resolveDisplayedOtherItem(
  lastSelectedItem: OtherItemID | null,
  activeTool: ToolID,
  isCineOpen: boolean
): OtherItemID | null {
  if (lastSelectedItem === 'cine' && isCineOpen) return 'cine';
  if (lastSelectedItem !== null && lastSelectedItem !== 'cine') {
    if (activeTool === lastSelectedItem) return lastSelectedItem;
  }
  if (isOtherTool(activeTool)) return activeTool;
  return isCineOpen ? 'cine' : null;
}

export default function Toolbar({
  activeTool,
  onSelectTool,
  onReset,
  onRotate90,
  onFlipHorizontal,
  isCineOpen,
  onToggleCine,
  onCloseCine,
  viewportEl,
  isSeriesSR = false,
  disabled = false,
}: ToolbarProps) {
  const closeCineForNonCineAction = () => {
    if (isCineOpen) onCloseCine();
  };

  const selectNonCineTool = (tool: ToolID, action?: () => void) => {
    closeCineForNonCineAction();
    action?.();
    onSelectTool(tool);
  };

  const renderButton = (tool: ToolID, iconClass: string, title: string) => {
    const isActive = activeTool === tool;
    const tooltip = getToolTooltip(tool, { label: title, detail: `${title} Tool` });
    return (
      <ToolbarTooltip label={tooltip.label} detail={tooltip.detail}>
        <Button
          onClick={() => selectNonCineTool(tool)}
          disabled={disabled}
          variant={isActive ? 'default' : 'ghost'}
          className={`
            w-8 h-8 sm:w-9 sm:h-9 p-0 flex items-center justify-center
            border border-border rounded-md
            ${isActive
              ? 'bg-primary text-primary-foreground'
              : 'bg-transparent text-foreground'}
          `}
          aria-label={`${tooltip.label} — ${tooltip.detail}`}
          data-testid={`toolbar-tool-${tool}`}
        >
          <i className={iconClass} />
        </Button>
      </ToolbarTooltip>
    );
  };

  const isOtherToolActive = isOtherTool(activeTool);
  const [lastSelectedOtherItem, setLastSelectedOtherItem] =
    useState<OtherItemID | null>(() =>
      isCineOpen ? 'cine' : isOtherToolActive ? activeTool : null
    );

  // Opening Cine preserves the current mouse tool. Selecting any non-Cine
  // toolbar action closes Cine; the trigger represents the latest valid item.
  const displayedOtherItem = resolveDisplayedOtherItem(
    lastSelectedOtherItem,
    activeTool,
    isCineOpen
  );
  const displayedOtherTool =
    displayedOtherItem !== 'cine' ? displayedOtherItem : null;
  const isOtherControlActive = isCineOpen || isOtherToolActive;
  const otherIcon = displayedOtherTool
    ? getIconForOtherTool(displayedOtherTool)
    : 'tools';
  const otherTooltip = displayedOtherItem === 'cine'
    ? { label: 'Cine', detail: 'Cine Controls' }
    : displayedOtherTool
      ? getToolTooltip(displayedOtherTool, MORE_TOOLS_TOOLTIP)
      : MORE_TOOLS_TOOLTIP;

  return (
    <TooltipProvider>
      <div
        className="h-full overflow-x-auto"
        aria-busy={disabled}
        data-interaction-disabled={disabled || undefined}
      >
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
            onSelectTool={(tool) => selectNonCineTool(tool)}
            readOnly={isSeriesSR}
            disabled={disabled}
          />

          {renderButton('zoom', 'fas fa-search-plus', 'Zoom')}
          {renderButton('pan', 'fas fa-arrows-alt', 'Pan')}
          {renderButton('adjust', 'fas fa-adjust', 'Adjust')}

          {/* CaptureControl */}
          <CaptureControl
            viewportEl={viewportEl ?? null}
            disabled={disabled}
            onActivate={closeCineForNonCineAction}
          />

          {/* Other Tools Dropdown */}
          <DropdownMenu>
            <ToolbarTooltip label={otherTooltip.label} detail={otherTooltip.detail}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={isOtherControlActive ? 'default' : 'ghost'}
                  className="w-12 sm:w-14 h-8 sm:h-9 p-0 flex items-center justify-center border border-border rounded-md"
                  aria-label={`${otherTooltip.label} — ${otherTooltip.detail}`}
                  data-displayed-item={displayedOtherItem ?? 'more'}
                  data-testid="other-tools-trigger"
                >
                  {displayedOtherItem === 'cine' ? (
                    <CirclePlay className="sm:mr-1" aria-hidden="true" />
                  ) : (
                    <i className={`fas fa-${otherIcon} sm:mr-1`} />
                  )}
                  <i className="fas fa-ellipsis-h hidden sm:inline" />
                </Button>
              </DropdownMenuTrigger>
            </ToolbarTooltip>
            <DropdownMenuContent
              className="z-[90] w-56 bg-card text-foreground border border-border"
              data-testid="other-tools-menu"
            >
              <DropdownMenuLabel>Other</DropdownMenuLabel>
              <DropdownMenuGroup>
                {/* Cine is a viewport state, not an active mouse tool. */}
                <DropdownMenuItem
                  disabled={isSeriesSR}
                  onSelect={() => {
                    if (isSeriesSR) return;
                    setLastSelectedOtherItem('cine');
                    onToggleCine();
                  }}
                  className={isCineOpen ? 'bg-muted text-foreground' : undefined}
                  aria-label={isCineOpen ? 'Đóng Cine' : 'Mở Cine'}
                  data-other-item="cine"
                >
                  <CirclePlay aria-hidden="true" /> Cine
                </DropdownMenuItem>

                {/* Angle Tool */}
                <DropdownMenuItem
                  onClick={(e) => {
                    if (isSeriesSR || disabled) {
                      e.stopPropagation();
                      return;
                    }
                    setLastSelectedOtherItem('angle');
                    selectNonCineTool('angle');
                  }}
                  disabled={isSeriesSR || disabled}
                  className="w-full text-left flex items-center px-2 py-2"
                  data-other-item="angle"
                >
                  <i className="fas fa-angle-right mr-2" /> Angle
                </DropdownMenuItem>

                {/* Rotate 90° */}
                <DropdownMenuItem
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setLastSelectedOtherItem('rotate90');
                    selectNonCineTool('rotate90', onRotate90);
                  }}
                  data-other-item="rotate90"
                >
                  <i className="fas fa-sync-alt mr-2" /> Rotate 90°
                </DropdownMenuItem>

                {/* Flip Horizontal */}
                <DropdownMenuItem
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setLastSelectedOtherItem('flipHorizontal');
                    selectNonCineTool('flipHorizontal', onFlipHorizontal);
                  }}
                  data-other-item="flipHorizontal"
                >
                  <i className="fas fa-arrows-h mr-2" /> Flip Horizontal
                </DropdownMenuItem>

                {/* Reset */}
                <DropdownMenuItem
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setLastSelectedOtherItem('reset');
                    selectNonCineTool('reset', onReset);
                  }}
                  data-other-item="reset"
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
