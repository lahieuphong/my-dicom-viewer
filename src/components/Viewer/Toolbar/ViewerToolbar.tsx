// src/components/Viewer/Toolbar/ViewerToolbar.tsx
'use client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToolID } from '@/hooks/useToolManager';
import { cancelActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';

import CaptureControl from './CaptureControl';
import MeasurementToolsControl from './MeasurementToolsControl';
import OtherToolsControl from './OtherToolsControl';
import ToolbarTooltip from './ToolbarTooltip';
import type { OtherItemID } from './otherToolDefinitions';
import { getToolTooltip } from './tooltips';

interface ToolbarProps {
  activeTool: ToolID;
  onSelectTool: (tool: ToolID) => void;
  onReset: () => void;
  onRotate90: () => void;
  onFlipHorizontal: () => void;
  isInverted: boolean;
  canInvert: boolean;
  onToggleInvert: () => void;
  isImageSliceSyncEnabled: boolean;
  canImageSliceSync: boolean;
  onToggleImageSliceSync: () => void;
  canCalibrate: boolean;
  onOpenDicomTagBrowser: () => void;

  isCineOpen: boolean;
  onToggleCine: () => void;
  onCloseCine: () => void;

  viewportEl?: HTMLDivElement | null;

  // NEW prop: whether current series is SR (read-only)
  isSeriesSR?: boolean;
  disabled?: boolean;
}

export default function Toolbar({
  activeTool,
  onSelectTool,
  onReset,
  onRotate90,
  onFlipHorizontal,
  isInverted,
  canInvert,
  onToggleInvert,
  isImageSliceSyncEnabled,
  canImageSliceSync,
  onToggleImageSliceSync,
  canCalibrate,
  onOpenDicomTagBrowser,
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

  const selectNonCineTool = (tool: ToolID) => {
    closeCineForNonCineAction();
    onSelectTool(tool);
  };

  const runViewportAction = (action: () => void) => {
    closeCineForNonCineAction();
    cancelActiveAnnotationInteraction(viewportEl);
    action();
  };

  const handleOtherItemSelect = (item: OtherItemID) => {
    switch (item) {
      case 'cine':
        if (!isCineOpen) {
          cancelActiveAnnotationInteraction(viewportEl);
          // Calibration is a transient, image-specific mode. Do not leave it
          // bound to primary drag while Cine advances through other images.
          if (
            activeTool === 'calibrationLine' ||
            activeTool === 'windowLevelRegion'
          ) {
            onSelectTool('adjust');
          }
        }
        onToggleCine();
        return;
      case 'invert':
        closeCineForNonCineAction();
        onToggleInvert();
        return;
      case 'imageSliceSync':
        onToggleImageSliceSync();
        return;
      case 'probe':
        selectNonCineTool('probe');
        return;
      case 'angle':
        selectNonCineTool('angle');
        return;
      case 'cobbAngle':
        selectNonCineTool('cobbAngle');
        return;
      case 'magnify':
        selectNonCineTool('magnify');
        return;
      case 'advancedMagnify':
        selectNonCineTool('advancedMagnify');
        return;
      case 'windowLevelRegion':
        selectNonCineTool('windowLevelRegion');
        return;
      case 'calibrationLine':
        selectNonCineTool('calibrationLine');
        return;
      case 'dicomTagBrowser':
        runViewportAction(onOpenDicomTagBrowser);
        return;
      case 'rotate90':
        runViewportAction(onRotate90);
        return;
      case 'flipHorizontal':
        runViewportAction(onFlipHorizontal);
        return;
      case 'reset':
        runViewportAction(onReset);
    }
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

          <OtherToolsControl
            activeTool={activeTool}
            isCineOpen={isCineOpen}
            isInverted={isInverted}
            isImageSliceSyncEnabled={isImageSliceSyncEnabled}
            canInvert={canInvert}
            canImageSliceSync={canImageSliceSync}
            canCalibrate={canCalibrate}
            onSelectItem={handleOtherItemSelect}
            readOnly={isSeriesSR}
            disabled={disabled}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
