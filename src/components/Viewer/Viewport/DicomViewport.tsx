// src/components/Viewer/Viewport/DicomViewport.tsx
'use client';
import React from 'react';
import { VIEWPORT_ID } from '@/constants/viewport';

interface DicomViewportProps {
  elementRef: React.RefObject<HTMLDivElement | null>;
  crosshair?: boolean;
}

export default function DicomViewport({
  elementRef,
  crosshair = false,
}: DicomViewportProps): React.ReactElement {
  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      role="region"
      aria-label="DICOM viewport (container)"
      tabIndex={0}
      data-testid="dicom-viewport"
      className={
        `viewport-container w-full h-full border border-neutral-800 ` +
        `${crosshair ? 'cursor-crosshair ' : 'cursor-default '}` +
        `overflow-hidden flex items-center justify-center`
      }
      style={{ minHeight: 0, position: 'relative' }}
    >
      {/* THIS INNER DIV is the one we enable for Cornerstone */}
      <div
        ref={elementRef}
        className="viewport-element w-full h-full"
        data-viewport-role="content"
        data-viewport-uid={VIEWPORT_ID}
        aria-label="DICOM viewport element"
        style={{ width: '100%', height: '100%', display: 'block', minHeight: 0, position: 'relative', touchAction: 'none' }}
      />
    </div>
  );
}
