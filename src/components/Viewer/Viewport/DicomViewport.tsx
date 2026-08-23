// src/components/Viewer/Viewport/DicomViewport.tsx
'use client';
import React from 'react';
import { VIEWPORT_ID } from '@/constants/viewport';

interface DicomViewportProps {
  elementRef: React.RefObject<HTMLDivElement | null>;
  viewportId?: string;
  crosshair?: boolean;
  interactionDisabled?: boolean;
}

export default function DicomViewport({
  elementRef,
  viewportId = VIEWPORT_ID,
  crosshair = false,
  interactionDisabled = false,
}: DicomViewportProps): React.ReactElement {
  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      role="region"
      aria-label="DICOM viewport (container)"
      aria-busy={interactionDisabled}
      inert={interactionDisabled ? true : undefined}
      tabIndex={interactionDisabled ? -1 : 0}
      data-testid="dicom-viewport"
      data-interaction-disabled={interactionDisabled || undefined}
      className={
        `viewport-container w-full h-full ` +
        `${interactionDisabled ? 'pointer-events-none cursor-wait ' : crosshair ? 'cursor-crosshair ' : 'cursor-default '}` +
        `overflow-hidden flex items-center justify-center`
      }
      style={{ minHeight: 0, position: 'relative' }}
    >
      {/* THIS INNER DIV is the one we enable for Cornerstone */}
      <div
        ref={elementRef}
        id={`${viewportId}-element`}
        className="viewport-element w-full h-full"
        data-viewport-role="content"
        data-viewport-uid={viewportId}
        aria-label="DICOM viewport element"
        style={{ width: '100%', height: '100%', display: 'block', minHeight: 0, position: 'relative', touchAction: 'none' }}
      />
    </div>
  );
}
