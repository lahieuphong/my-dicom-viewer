'use client';

import BasicViewerImplementation from './BasicViewerImplementation';

export type BasicViewerProps = {
  studyUID: string;
};

/**
 * Compatibility entry point for the existing viewer workflow.
 *
 * Keeping this wrapper deliberately thin preserves the current UI, state and
 * Cornerstone lifecycle while giving future modes a stable composition point.
 */
export function BasicViewer(props: BasicViewerProps) {
  return <BasicViewerImplementation {...props} />;
}

export default BasicViewer;
