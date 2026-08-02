'use client';

import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ToolID } from '@/hooks/useToolManager';

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
      className="flex h-10 items-center"
      data-active={Boolean(activeDefinition)}
      data-testid="measurement-tools-control"
    >
      <ToolbarTooltip label={tooltip.label} detail={tooltip.detail}>
        <Button
          type="button"
          variant={activeDefinition ? 'default' : 'ghost'}
          disabled={readOnly}
          onClick={() => onSelectTool(primaryDefinition.id)}
          className="h-10 w-10 rounded-lg rounded-r-none border border-r-0 border-border p-0"
          aria-label={`${tooltip.label} — ${tooltip.detail}`}
          data-tool-id={primaryDefinition.id}
        >
          <Icon className="size-7" />
        </Button>
      </ToolbarTooltip>

      <span
        aria-hidden="true"
        className="h-5 w-px shrink-0 bg-primary"
      />

      <DropdownMenu>
        <ToolbarTooltip
          label={MEASUREMENT_TOOLS_TOOLTIP.label}
          detail={MEASUREMENT_TOOLS_TOOLTIP.detail}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-5 min-w-5 max-w-5 rounded-lg rounded-l-none border border-l-0 border-border p-0 has-[>svg]:px-0 text-foreground hover:text-primary"
              aria-label="Mở danh sách công cụ đo lường"
              data-testid="measurement-tools-menu-trigger"
            >
              <ChevronDown className="size-5 text-primary" />
            </Button>
          </DropdownMenuTrigger>
        </ToolbarTooltip>

        <DropdownMenuContent
          side="bottom"
          align="start"
          alignOffset={-40}
          className="min-w-32 rounded border-[hsla(236,52%,30%,0.5)] bg-[hsl(219,90%,15%)] p-1 text-[hsl(0,0%,98%)] shadow-md"
          data-testid="measurement-tools-menu"
        >
          <DropdownMenuGroup>
            {MEASUREMENT_MENU_TOOLS.map(({ id, label, detail, Icon: ItemIcon }) => (
              <DropdownMenuItem
                key={id}
                disabled={readOnly}
                onSelect={() => onSelectTool(id)}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-base font-normal text-[hsl(0,0%,98%)] focus:bg-[hsl(217,79%,24%)] focus:text-[hsl(0,0%,98%)] data-[disabled]:cursor-not-allowed"
                aria-label={`${label} — ${detail}`}
                data-tool-id={id}
                data-active={activeTool === id}
              >
                <ItemIcon className="size-6 shrink-0 text-white" />
                <span className="pl-1 leading-6">{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
