export { default as ViewerWorkspace } from '@/components/Viewer/Workspace/ViewerWorkspace';

export {
  default as useViewerLayout,
  useViewerLayout as useViewerLayoutState,
} from '@/hooks/useViewerLayout';

export {
  useViewerPanelResize,
} from '@/hooks/useViewerPanelResize';

export type {
  ViewerPanelResizeEndHandler,
  ViewerPanelResizeKeyHandler,
  ViewerPanelResizeMoveHandler,
  ViewerPanelResizeSide,
  ViewerPanelResizeStartHandler,
} from '@/hooks/useViewerPanelResize';
