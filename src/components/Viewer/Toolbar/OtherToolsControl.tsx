'use client';

import { useEffect, useRef, useState } from 'react';

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
  getOtherToolDefinition,
  isOtherTool,
  OTHER_TOOL_ITEMS,
  resolveDisplayedOtherItem,
  type OtherItemID,
} from './otherToolDefinitions';
import { MORE_TOOLS_TOOLTIP } from './tooltips';

type OtherToolsControlProps = {
  activeTool: ToolID;
  isCineOpen: boolean;
  isInverted: boolean;
  canInvert: boolean;
  canCalibrate: boolean;
  onSelectItem: (item: OtherItemID) => void;
  readOnly?: boolean;
  disabled?: boolean;
};

function isItemActive(
  item: OtherItemID,
  activeTool: ToolID,
  isCineOpen: boolean,
  isInverted: boolean
) {
  if (item === 'cine') return isCineOpen;
  if (item === 'invert') return isInverted;
  if (item === 'dicomTagBrowser') return false;
  return activeTool === item;
}

export default function OtherToolsControl({
  activeTool,
  isCineOpen,
  isInverted,
  canInvert,
  canCalibrate,
  onSelectItem,
  readOnly = false,
  disabled = false,
}: OtherToolsControlProps) {
  const [lastSelectedItem, setLastSelectedItem] =
    useState<OtherItemID | null>(() =>
      isCineOpen
        ? 'cine'
        : isOtherTool(activeTool)
          ? activeTool
          : isInverted
            ? 'invert'
            : null
    );
  const deferredDialogActionRef = useRef<OtherItemID | null>(null);
  const deferredDialogTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (deferredDialogTimerRef.current !== null) {
        window.clearTimeout(deferredDialogTimerRef.current);
      }
    };
  }, []);

  const runDeferredDialogAction = () => {
    const item = deferredDialogActionRef.current;
    if (!item) return;

    deferredDialogActionRef.current = null;
    if (deferredDialogTimerRef.current !== null) {
      window.clearTimeout(deferredDialogTimerRef.current);
    }

    // A modal DropdownMenu and a modal Dialog both temporarily disable body
    // pointer events. Opening the Dialog from the menu item's select event can
    // make the Dialog capture `pointer-events: none` as the value to restore,
    // leaving the viewer inert after the Dialog closes. Wait until Radix has
    // fully closed the menu and restored its interaction lock first.
    deferredDialogTimerRef.current = window.setTimeout(() => {
      deferredDialogTimerRef.current = null;
      onSelectItem(item);
    }, 0);
  };

  const displayedItem = resolveDisplayedOtherItem(
    lastSelectedItem,
    activeTool,
    isCineOpen,
    isInverted
  );
  const displayedDefinition = displayedItem
    ? getOtherToolDefinition(displayedItem)
    : null;
  const tooltip = displayedDefinition ?? MORE_TOOLS_TOOLTIP;
  const isControlActive = Boolean(
    isCineOpen || isInverted || isOtherTool(activeTool)
  );
  const DisplayedIcon = displayedDefinition?.Icon;

  return (
    <DropdownMenu>
      <ToolbarTooltip label={tooltip.label} detail={tooltip.detail}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={isControlActive ? 'default' : 'ghost'}
            disabled={disabled}
            className="h-8 w-12 rounded-md border border-border p-0 sm:h-9 sm:w-14"
            aria-label={`${tooltip.label} — ${tooltip.detail}`}
            data-displayed-item={displayedItem ?? 'more'}
            data-testid="other-tools-trigger"
          >
            {DisplayedIcon ? (
              <DisplayedIcon
                className="size-4 sm:mr-1"
                aria-hidden="true"
              />
            ) : (
              <i
                className="fas fa-tools text-sm sm:mr-1"
                aria-hidden="true"
              />
            )}
            <i
              className="fas fa-ellipsis-h hidden text-xs sm:inline"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>

      <DropdownMenuContent
        className="z-[90] w-56 border border-border bg-card text-foreground"
        data-testid="other-tools-menu"
        onCloseAutoFocus={runDeferredDialogAction}
      >
        <DropdownMenuLabel>Other</DropdownMenuLabel>
        <DropdownMenuGroup>
          {OTHER_TOOL_ITEMS.map((definition) => {
            const {
              id,
              menuLabel,
              label,
              detail,
              Icon,
              disabledForSR,
            } = definition;
            const active = isItemActive(
              id,
              activeTool,
              isCineOpen,
              isInverted
            );
            const itemDisabled =
              disabled ||
              (readOnly && disabledForSR) ||
              (id === 'invert' && !canInvert) ||
              (id === 'calibrationLine' && !canCalibrate);
            const isToggle = id === 'cine' || id === 'invert';

            return (
              <DropdownMenuItem
                key={id}
                disabled={itemDisabled}
                onSelect={() => {
                  if (itemDisabled) return;
                  setLastSelectedItem(id);
                  if (definition.kind === 'dialog-action') {
                    deferredDialogActionRef.current = id;
                    return;
                  }
                  onSelectItem(id);
                }}
                className={cn(
                  'flex w-full items-center px-2 py-2 text-left',
                  active && 'bg-muted text-foreground'
                )}
                aria-label={`${label} — ${detail}`}
                role={isToggle ? 'menuitemcheckbox' : undefined}
                aria-checked={isToggle ? active : undefined}
                data-active={active}
                data-other-item={id}
              >
                <Icon
                  className="mr-2 size-4 shrink-0 text-foreground"
                  aria-hidden="true"
                />
                <span>{menuLabel}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
