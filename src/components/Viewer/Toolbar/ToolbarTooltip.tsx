'use client';

import type { ReactElement } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ToolbarTooltipProps = {
  label: string;
  detail?: string;
  children: ReactElement;
  wrapDisabledTrigger?: boolean;
};

/** Two-line, theme-aware tooltip used by icon-only viewer controls. */
export default function ToolbarTooltip({
  label,
  detail,
  children,
  wrapDisabledTrigger = false,
}: ToolbarTooltipProps) {
  const trigger = wrapDisabledTrigger ? (
    <span className="inline-flex shrink-0">{children}</span>
  ) : (
    children
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="bottom" align="center">
        <div className="whitespace-nowrap text-sm font-semibold leading-5">
          {label}
        </div>
        {detail && (
          <div className="mt-0.5 whitespace-nowrap text-xs font-medium leading-4 text-primary">
            {detail}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

