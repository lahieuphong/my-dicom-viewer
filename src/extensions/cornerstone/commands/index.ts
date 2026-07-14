import {
  CommandManager,
  type CommandSpec,
} from '@/platform/core';

export type CornerstoneCommandSchema = {
  'viewport.activateTool': CommandSpec<{
    viewportId: string;
    toolId: string;
  }>;
  'viewport.rotate': CommandSpec<{
    viewportId: string;
    degrees: number;
  }>;
  'viewport.flipHorizontal': CommandSpec<{ viewportId: string }>;
  'viewport.reset': CommandSpec<{ viewportId: string }>;
  'viewport.setImageIndex': CommandSpec<{
    viewportId: string;
    imageIndex: number;
  }>;
  'cine.toggle': CommandSpec<{ viewportId: string }>;
  'viewport.capture': CommandSpec<{ viewportId: string }, Blob | void>;
  'measurement.jumpTo': CommandSpec<{
    viewportId: string;
    annotationUID: string;
  }>;
};

/** Creates a command registry scoped to one ViewerRuntime. */
export function createCornerstoneCommandManager() {
  return new CommandManager<CornerstoneCommandSchema>();
}
