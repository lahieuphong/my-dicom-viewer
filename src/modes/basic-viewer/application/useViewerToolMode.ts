// The active toolbar tool of the basic-viewer mode.
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ToolGroupManager,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';
import {
  readOnlyBlockedToolIDs,
  toolNameMap,
  useToolManager,
  type ToolID,
} from '@/extensions/cornerstone';

/**
 * The tool the toolbar shows as active and its activation in Cornerstone's
 * tool group. A tool picked before the tools are registered is activated once
 * they are. While `readOnly` (an SR is open), the tools that would edit
 * annotations lose their bindings and the viewer falls back to 'adjust';
 * leaving read-only mode gives them their primary-button binding back.
 */
export function useViewerToolMode({ readOnly }: { readOnly: boolean }) {
  const { activateTool, isToolReady } = useToolManager();
  const [activeTool, setActiveTool] = useState<ToolID>('adjust');
  // The tool last activated in Cornerstone, so a re-render does not activate
  // it again; null after a failed activation, so it is retried.
  const lastActivatedToolRef = useRef<ToolID | null>(null);

  const handleSelectTool = useCallback((tool: ToolID) => {
    if (!isToolReady) {
      lastActivatedToolRef.current = null;
      setActiveTool(tool);
      return;
    }
    try {
      const ok = activateTool(tool, { isSeriesSR: readOnly });
      if (ok) {
        lastActivatedToolRef.current = tool;
        setActiveTool(tool);
      } else {
        lastActivatedToolRef.current = null;
        setActiveTool('adjust');
      }
    } catch {
      lastActivatedToolRef.current = null;
      setActiveTool('adjust');
    }
  }, [isToolReady, activateTool, readOnly]);

  // useToolManager reads this flag while it activates tools.
  useLayoutEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__CURRENT_SERIES_IS_SR = !!readOnly;
    }
  }, [readOnly]);

  useEffect(() => {
    if (!isToolReady) return;
    if (lastActivatedToolRef.current === activeTool) return;

    try {
      const ok = activateTool(activeTool, { isSeriesSR: readOnly });
      lastActivatedToolRef.current = ok ? activeTool : null;
    } catch {
      lastActivatedToolRef.current = null;
    }
  }, [activeTool, isToolReady, readOnly, activateTool]);

  useEffect(() => {
    const tg = ToolGroupManager.getToolGroup(TOOL_GROUP);
    if (!tg) return;

    if (readOnly) {
      if (activeTool !== 'adjust') setActiveTool('adjust');

      readOnlyBlockedToolIDs.forEach((id) => {
        const name = toolNameMap[id];
        try { tg.setToolPassive(name); } catch {}
        try { tg.setToolConfiguration(name, { bindings: [] }); } catch {}
      });

      if (isToolReady && lastActivatedToolRef.current !== 'adjust') {
        try {
          const ok = activateTool('adjust', { isSeriesSR: true });
          if (ok) lastActivatedToolRef.current = 'adjust';
        } catch {
          lastActivatedToolRef.current = null;
        }
      }
    } else {
      readOnlyBlockedToolIDs.forEach((id) => {
        const name = toolNameMap[id];
        try {
          tg.setToolConfiguration(name, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
          });
        } catch {}
      });
    }
  }, [readOnly, isToolReady, activateTool, activeTool]);

  return { activeTool, handleSelectTool };
}
