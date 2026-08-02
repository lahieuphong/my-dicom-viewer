'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ToolID } from '@/hooks/useToolManager';
import { cn } from '@/lib/utils';

import ToolbarTooltip from './ToolbarTooltip';
import {
  getMeasurementMenuTool,
  MEASUREMENT_MENU_TOOLS,
} from './measurementToolDefinitions';
import { MEASUREMENT_TOOLS_TOOLTIP } from './tooltips';

type MeasurementToolsControlProps = {
  activeTool: ToolID;
  onSelectTool: (tool: ToolID) => void;
  readOnly?: boolean;
};

export default function MeasurementToolsControl({
  activeTool,
  onSelectTool,
  readOnly = false,
}: MeasurementToolsControlProps) {
  const activeDefinition = getMeasurementMenuTool(activeTool);
  const primaryDefinition = activeDefinition ?? MEASUREMENT_MENU_TOOLS[0];
  const { Icon } = primaryDefinition;
  const tooltip = activeDefinition ?? MEASUREMENT_TOOLS_TOOLTIP;

  return (
    <div
      className={cn(
        'flex h-8 w-12 items-center overflow-hidden rounded-md border border-border sm:h-9 sm:w-14',
        activeDefinition
          ? 'bg-primary text-primary-foreground shadow-xs'
          : 'bg-transparent text-foreground'
      )}
      data-active={Boolean(activeDefinition)}
      data-testid="measurement-tools-control"
    >
      <ToolbarTooltip label={tooltip.label} detail={tooltip.detail}>
        <Button
          type="button"
          variant="ghost"
          disabled={readOnly}
          onClick={() => onSelectTool(primaryDefinition.id)}
          className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 has-[>svg]:px-0 hover:bg-muted hover:text-foreground"
          aria-label={`${tooltip.label} — ${tooltip.detail}`}
          data-tool-id={primaryDefinition.id}
        >
          <Icon className="size-4" />
        </Button>
      </ToolbarTooltip>

      <DropdownMenu>
        <ToolbarTooltip
          label={MEASUREMENT_TOOLS_TOOLTIP.label}
          detail={MEASUREMENT_TOOLS_TOOLTIP.detail}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-full w-5 min-w-5 max-w-5 rounded-none border-0 bg-transparent p-0 text-current has-[>svg]:px-0 hover:bg-muted hover:text-foreground"
              aria-label="Mở danh sách công cụ đo lường"
              data-testid="measurement-tools-menu-trigger"
            >
              <i
                aria-hidden="true"
                className="fas fa-ellipsis-h text-xs"
              />
            </Button>
          </DropdownMenuTrigger>
        </ToolbarTooltip>

        <DropdownMenuContent
          className="w-56 border border-border bg-card text-foreground"
          data-testid="measurement-tools-menu"
        >
          <DropdownMenuLabel>Measurement</DropdownMenuLabel>
          <DropdownMenuGroup>
            {MEASUREMENT_MENU_TOOLS.map(({ id, label, detail, Icon: ItemIcon }) => (
              <DropdownMenuItem
                key={id}
                disabled={readOnly}
                onSelect={() => onSelectTool(id)}
                className="flex w-full items-center px-2 py-2 text-left"
                aria-label={`${label} — ${detail}`}
                data-tool-id={id}
                data-active={activeTool === id}
              >
                <ItemIcon className="mr-2 size-4 shrink-0 text-foreground" />
                <span>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
